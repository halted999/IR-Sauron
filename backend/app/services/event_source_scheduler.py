import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_redis
from app.core.crypto import decrypt_secret
from app.database import AsyncSessionLocal
from app.models import Alert, AlertStatus, CaseSeverity, EventSource, EventSourceType
from app.schemas import EventSourceSyncResult
from app.services.alert_rules import apply_matching_rules
from app.services.elastic_client import ElasticClient
from app.services.email_client import EmailClient
from app.services.file_watch_client import FileWatchClient
from app.services.json_api_client import JsonApiClient
from app.services.mitre_attack import raised_alert_severity
from app.services.thehive_client import TheHiveClient

logger = logging.getLogger(__name__)

_POLL_TICK_SECONDS = 60
_LOOKBACK_ON_FIRST_SYNC = timedelta(hours=24)
_TICK_LOCK_KEY = "event_source_poll_tick_lock"
_TICK_LOCK_TTL_SECONDS = 55

_THEHIVE_SEVERITY = {
    1: CaseSeverity.low,
    2: CaseSeverity.medium,
    3: CaseSeverity.high,
    4: CaseSeverity.critical,
}
_ELASTIC_SEVERITY_FIELDS = ["event.severity", "rule.severity", "kibana.alert.severity", "severity"]
_ELASTIC_TITLE_FIELDS = ["rule.name", "kibana.alert.rule.name", "message", "event.action"]
_TEXT_SEVERITY_ALIASES = {
    "critical": CaseSeverity.critical, "критический": CaseSeverity.critical,
    "high": CaseSeverity.high, "высокий": CaseSeverity.high,
    "medium": CaseSeverity.medium, "средний": CaseSeverity.medium,
    "low": CaseSeverity.low, "низкий": CaseSeverity.low,
    "informational": CaseSeverity.low, "информационный": CaseSeverity.low,
}


def _severity_from_text(value: Optional[str]) -> CaseSeverity:
    if not value:
        return CaseSeverity.medium
    return _TEXT_SEVERITY_ALIASES.get(value.strip().lower(), CaseSeverity.medium)

_scheduler: Optional[AsyncIOScheduler] = None


def _truncate(value: str, limit: int) -> str:
    return value if len(value) <= limit else value[: limit - 1] + "…"


async def _alert_exists(db: AsyncSession, source_id, external_id: str) -> bool:
    result = await db.execute(
        select(Alert.id).where(
            Alert.event_source_id == source_id,
            Alert.external_id == external_id,
        )
    )
    return result.scalar_one_or_none() is not None


# How many records (file_watch lines or json_api rows) to check/insert per
# DB round-trip. A poll that catches up on a large backlog (e.g. after the
# service was down for a while, or a paginated API returning thousands of
# rows) can have tens of thousands of pending records; batching keeps that
# to a handful of queries instead of one existence-check + one flush per row.
_INGEST_BATCH_SIZE = 500


async def _existing_external_ids(db: AsyncSession, source_id, external_ids: List[str]) -> set:
    if not external_ids:
        return set()
    result = await db.execute(
        select(Alert.external_id).where(
            Alert.event_source_id == source_id,
            Alert.external_id.in_(external_ids),
        )
    )
    return {row[0] for row in result.all()}


async def _bulk_ingest_alerts(
    db: AsyncSession, source: EventSource, candidates: List[Tuple[str, Dict[str, Any]]]
) -> int:
    """Shared batched existence-check + insert for sources that build their
    own list of (external_id, alert_kwargs) candidates up front (json_api).
    See _ingest_file_watch_records for the file_watch equivalent.
    """
    new_count = 0
    for batch_start in range(0, len(candidates), _INGEST_BATCH_SIZE):
        batch = candidates[batch_start : batch_start + _INGEST_BATCH_SIZE]
        ids = [external_id for external_id, _ in batch]
        existing = await _existing_external_ids(db, source.id, ids)

        # Unlike file_watch's byte-offset identity, a json_api candidate's
        # external_id can legitimately repeat within the same batch (content
        # hash for two identical records, or the same record fetched twice
        # across overlapping pages) — dedupe here too, not just against what
        # was already committed, or both copies would be inserted.
        new_alerts = []
        seen_ids = set()
        for external_id, kwargs in batch:
            if external_id in existing or external_id in seen_ids:
                continue
            seen_ids.add(external_id)
            alert = Alert(event_source_id=source.id, external_id=external_id, **kwargs)
            alert.severity = raised_alert_severity(alert.title, alert.description, alert.raw_event, alert.severity)
            new_alerts.append(alert)

        if not new_alerts:
            continue
        db.add_all(new_alerts)
        await db.flush()
        for alert in new_alerts:
            await apply_matching_rules(db, alert)
        new_count += len(new_alerts)

    return new_count


async def _ingest_file_watch_records(
    db: AsyncSession, source: EventSource, records: List[Dict[str, Any]]
) -> int:
    new_count = 0
    for batch_start in range(0, len(records), _INGEST_BATCH_SIZE):
        batch = records[batch_start : batch_start + _INGEST_BATCH_SIZE]
        # Offset (not mtime) is the stable per-row identity: appending to the
        # file changes its mtime but never the byte offset of already-read
        # lines, so re-polling a growing file can't re-create old alerts.
        candidate_ids = [f"{rec['_file']}:{rec['_offset']}" for rec in batch]
        existing = await _existing_external_ids(db, source.id, candidate_ids)

        new_alerts = []
        for rec, external_id in zip(batch, candidate_ids):
            if external_id in existing:
                continue
            alert = Alert(
                title=(rec.get("title") or f"{rec['_file']} #{rec['_offset']}")[:500],
                description=rec.get("description")
                or _truncate(json.dumps(rec["data"], ensure_ascii=False, default=str), 4000),
                raw_event=rec["data"],
                severity=_severity_from_text(rec.get("severity")),
                source=rec.get("source") or source.name,
                status=AlertStatus.new,
                event_source_id=source.id,
                external_id=external_id,
            )
            alert.severity = raised_alert_severity(alert.title, alert.description, alert.raw_event, alert.severity)
            new_alerts.append(alert)

        if not new_alerts:
            continue
        db.add_all(new_alerts)
        await db.flush()
        for alert in new_alerts:
            await apply_matching_rules(db, alert)
        new_count += len(new_alerts)

    return new_count


def _elastic_field(doc: Dict[str, Any], dotted_field: str) -> Any:
    node: Any = doc
    for part in dotted_field.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def _elastic_title(doc: Dict[str, Any], external_id: str) -> str:
    for field in _ELASTIC_TITLE_FIELDS:
        value = _elastic_field(doc, field)
        if value:
            return str(value)[:500]
    return f"Elastic alert {external_id}"


def _elastic_severity(doc: Dict[str, Any]) -> CaseSeverity:
    for field in _ELASTIC_SEVERITY_FIELDS:
        value = _elastic_field(doc, field)
        if value is None:
            continue
        text = str(value).strip().lower()
        for candidate in CaseSeverity:
            if candidate.value == text:
                return candidate
    return CaseSeverity.medium


async def sync_source(db: AsyncSession, source: EventSource) -> EventSourceSyncResult:
    since = source.last_synced_at or (datetime.now(timezone.utc) - _LOOKBACK_ON_FIRST_SYNC)
    config = source.config or {}
    new_count = 0

    try:
        secret = decrypt_secret(source.auth_secret_encrypted) if source.auth_secret_encrypted else None

        if source.source_type == EventSourceType.elastic:
            client = ElasticClient(source.base_url, source.auth_username, secret, source.verify_ssl)
            hits = await client.fetch_alerts(config.get("index_pattern"), config.get("query"), since)
            for hit in hits:
                external_id = hit.get("_id")
                if not external_id or await _alert_exists(db, source.id, str(external_id)):
                    continue
                doc = hit.get("_source", {}) or {}
                alert = Alert(
                    title=_elastic_title(doc, str(external_id)),
                    description=_truncate(json.dumps(doc, ensure_ascii=False, default=str), 4000),
                    raw_event=doc,
                    severity=_elastic_severity(doc),
                    source=source.name,
                    status=AlertStatus.new,
                    event_source_id=source.id,
                    external_id=str(external_id),
                    source_index=hit.get("_index"),
                )
                alert.severity = raised_alert_severity(alert.title, alert.description, alert.raw_event, alert.severity)
                db.add(alert)
                await db.flush()
                await apply_matching_rules(db, alert)
                new_count += 1
        elif source.source_type == EventSourceType.thehive:
            client = TheHiveClient(source.base_url, secret, source.verify_ssl)
            alerts = await client.fetch_alerts(since)
            for raw in alerts:
                external_id = raw.get("_id") or raw.get("id")
                if not external_id or await _alert_exists(db, source.id, str(external_id)):
                    continue
                alert = Alert(
                    title=(raw.get("title") or f"TheHive alert {external_id}")[:500],
                    description=raw.get("description"),
                    severity=_THEHIVE_SEVERITY.get(raw.get("severity"), CaseSeverity.medium),
                    source=source.name,
                    status=AlertStatus.new,
                    event_source_id=source.id,
                    external_id=str(external_id),
                    external_url=f"{source.base_url}/index.html#!/alert/{external_id}/details",
                )
                alert.severity = raised_alert_severity(alert.title, alert.description, alert.raw_event, alert.severity)
                db.add(alert)
                await db.flush()
                await apply_matching_rules(db, alert)
                new_count += 1

        elif source.source_type == EventSourceType.file_watch:
            client = FileWatchClient(
                folder_path=source.base_url,
                file_mask=config.get("file_mask"),
                file_format=config.get("file_format"),
                csv_delimiter=config.get("csv_delimiter"),
            )
            records, new_file_offsets = await client.fetch_records(source.file_offsets or {})
            new_count += await _ingest_file_watch_records(db, source, records)
            source.file_offsets = new_file_offsets

        elif source.source_type == EventSourceType.email:
            client = EmailClient(
                host=source.base_url,
                port=int(config.get("port") or 993),
                username=source.auth_username,
                password=secret,
                mailbox=config.get("mailbox") or "INBOX",
                use_ssl=bool(config.get("use_ssl", True)),
            )
            messages = await client.fetch_alerts(since)
            for msg in messages:
                external_id = msg.get("message_id") or f"{source.id}:{msg.get('date')}:{msg.get('subject')}"
                if await _alert_exists(db, source.id, external_id):
                    continue
                alert = Alert(
                    title=(msg.get("subject") or f"Письмо от {msg.get('from') or 'неизвестного отправителя'}")[:500],
                    description=_truncate(msg.get("body") or "", 4000),
                    raw_event=msg,
                    severity=CaseSeverity.medium,
                    source=msg.get("from") or source.name,
                    status=AlertStatus.new,
                    event_source_id=source.id,
                    external_id=external_id,
                )
                alert.severity = raised_alert_severity(alert.title, alert.description, alert.raw_event, alert.severity)
                db.add(alert)
                await db.flush()
                await apply_matching_rules(db, alert)
                new_count += 1

        else:  # EventSourceType.json_api
            client = JsonApiClient(
                base_url=source.base_url,
                api_key=secret,
                api_key_header=config.get("api_key_header") or "X-API-Key",
                json_path=config.get("json_path"),
                title_field=config.get("title_field"),
                description_field=config.get("description_field"),
                severity_field=config.get("severity_field"),
                id_field=config.get("id_field"),
                verify_ssl=source.verify_ssl,
                since_param=config.get("since_param"),
                since_format=config.get("since_format") or "iso",
                page_param=config.get("page_param"),
                page_size_param=config.get("page_size_param"),
                page_size=int(config["page_size"]) if config.get("page_size") else None,
                page_start=int(config.get("page_start") or 1),
                max_pages=int(config.get("max_pages") or 100),
                timeout_seconds=float(config.get("timeout_seconds") or 30),
                max_response_bytes=int(config.get("max_response_bytes") or (50 * 1024 * 1024)),
            )
            rows = await client.fetch_records(since)
            candidates: List[Tuple[str, Dict[str, Any]]] = []
            for row in rows:
                rec = client.normalize(row)
                candidates.append((
                    str(rec["external_id"]),
                    dict(
                        title=(rec.get("title") or f"{source.name} alert")[:500],
                        description=rec.get("description")
                        or _truncate(json.dumps(row, ensure_ascii=False, default=str), 4000),
                        raw_event=row,
                        severity=_severity_from_text(rec.get("severity")),
                        source=rec.get("source") or source.name,
                        status=AlertStatus.new,
                    ),
                ))
            new_count += await _bulk_ingest_alerts(db, source, candidates)

        source.last_synced_at = datetime.now(timezone.utc)
        source.last_sync_status = "success"
        source.last_sync_message = f"Получено новых алертов: {new_count}"
        source.last_sync_alert_count = new_count
        await db.flush()
        return EventSourceSyncResult(ok=True, message=source.last_sync_message, new_alerts=new_count)

    except Exception as exc:  # noqa: BLE001
        message = _truncate(f"Ошибка синхронизации: {exc}", 2000)
        logger.warning("Event source %s (%s) sync failed: %s", source.id, source.name, exc)
        source.last_sync_status = "error"
        source.last_sync_message = message
        await db.flush()
        return EventSourceSyncResult(ok=False, message=message, new_alerts=0)


async def _poll_tick() -> None:
    # uvicorn runs several worker processes, each with its own AsyncIOScheduler
    # (see start_scheduler below), so this fires roughly 4x per interval — once
    # per worker, all within the same fraction of a second. The lock's TTL
    # (just under _POLL_TICK_SECONDS) is what actually de-dupes those calls
    # down to one real sync per interval: it must NOT be deleted as soon as
    # this tick finishes, or every worker's near-simultaneous tick would pass
    # the acquire check and each poll the source. Let it expire on its own.
    redis = await get_redis()
    acquired = await redis.set(_TICK_LOCK_KEY, "1", nx=True, ex=_TICK_LOCK_TTL_SECONDS)
    if not acquired:
        return

    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(EventSource).where(EventSource.is_enabled.is_(True)))
            sources = list(result.scalars().all())
            now = datetime.now(timezone.utc)
            for source in sources:
                due = (
                    source.last_synced_at is None
                    or (now - source.last_synced_at).total_seconds() >= source.poll_interval_seconds
                )
                if due:
                    await sync_source(session, source)
            await session.commit()
    except Exception:  # noqa: BLE001
        logger.exception("Event source poll tick failed")


def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(_poll_tick, "interval", seconds=_POLL_TICK_SECONDS, id="event_source_poll_tick")
    _scheduler.start()
    logger.info("Event source poll scheduler started (every %ss)", _POLL_TICK_SECONDS)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
