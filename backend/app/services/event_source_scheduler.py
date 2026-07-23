import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

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
                    severity=_elastic_severity(doc),
                    source=source.name,
                    status=AlertStatus.new,
                    event_source_id=source.id,
                    external_id=str(external_id),
                )
                db.add(alert)
                await db.flush()
                await apply_matching_rules(db, alert)
                new_count += 1
        else:
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
                db.add(alert)
                await db.flush()
                await apply_matching_rules(db, alert)
                new_count += 1

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
    finally:
        await redis.delete(_TICK_LOCK_KEY)


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
