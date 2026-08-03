from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Annotated, Dict, List, Optional, Set, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_active_user
from app.database import get_db
from app.models import Alert, Case, IOC, User
from app.schemas import (
    CorrelationGraphResponse, GraphEdge, GraphNode, StatisticsPeriod, StatisticsResponse, StatusCount,
    ThreatTypeCount, TimelinePoint, ValueCount,
)
from app.services.kql import KqlSyntaxError, evaluate_text, matches_text, parse_kql
from app.services.alert_stats_parsing import (
    classify_threat_type, is_internal_ip, resolve_accounts, resolve_files, resolve_ips, resolve_urls,
)

router = APIRouter(prefix="/statistics", tags=["statistics"])

_PERIODS = {"day", "current_week", "7d", "current_month", "30d", "custom"}
_TOP_N = 20
_THREAT_TYPE_DETAIL_TOP_N = 5
_ENTITY_TOP_N = {"ip": 12, "account": 12, "file": 8, "ioc": 8}
_MAX_ALERTS_PER_ENTITY = 15
_SEARCH_ENTITY_CAP = 30
_SEARCH_MAX_ALERTS_PER_ENTITY = 60

# Curated IOC records (added by analysts on a case) are mapped onto the
# existing ip/account/file graph buckets where the type fits; domain/url
# don't fit any of those, so they get a generic "ioc" bucket of their own.
_IOC_KIND_MAP = {
    "ip": "ip",
    "email": "account",
    "filename": "file",
    "hash_md5": "file",
    "hash_sha256": "file",
    "domain": "ioc",
    "url": "ioc",
}


def _emit_entity_nodes(
    matches: Dict[str, Set[str]],
    kind: str,
    cap: int,
    max_alerts: int,
    alert_info: Dict[str, Tuple[str, str, datetime]],
    nodes: List[GraphNode],
    edges: List[GraphEdge],
    included_alert_ids: Set[str],
) -> bool:
    truncated = False
    items = sorted(matches.items(), key=lambda kv: len(kv[1]), reverse=True)
    if len(items) > cap:
        truncated = True
    for value, alert_ids in items[:cap]:
        capped_ids = alert_ids
        if len(capped_ids) > max_alerts:
            truncated = True
            capped_ids = set(
                sorted(capped_ids, key=lambda aid: alert_info[aid][2], reverse=True)[:max_alerts]
            )
        entity_id = f"{kind}:{value}"
        nodes.append(GraphNode(id=entity_id, kind=kind, label=value, degree=len(capped_ids)))
        for alert_id_str in capped_ids:
            edges.append(GraphEdge(source=entity_id, target=alert_id_str, kind=kind))
            included_alert_ids.add(alert_id_str)
    return truncated


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _period_bounds(
    period: str, start: Optional[datetime], end: Optional[datetime],
) -> Tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    if period == "day":
        return now - timedelta(days=1), now
    if period == "current_week":
        week_start = (now - timedelta(days=now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        return week_start, now
    if period == "7d":
        return now - timedelta(days=7), now
    if period == "current_month":
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return month_start, now
    if period == "30d":
        return now - timedelta(days=30), now
    if period == "custom":
        if start is None or end is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Для периода 'custom' обязательны параметры start и end",
            )
        start, end = _as_utc(start), _as_utc(end)
        if start > end:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="start не может быть позже end"
            )
        return start, end
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестный период")


def _top(counter: "Counter[str]", n: int = _TOP_N) -> List[ValueCount]:
    return [ValueCount(value=value, count=count) for value, count in counter.most_common(n)]


def _timeline_granularity(period_start: datetime, period_end: datetime) -> str:
    span = period_end - period_start
    if span <= timedelta(days=2):
        return "hour"
    if span <= timedelta(days=180):
        return "day"
    if span <= timedelta(days=1000):
        return "week"
    return "month"


def _truncate_to_bucket(ts: datetime, granularity: str) -> datetime:
    if granularity == "hour":
        return ts.replace(minute=0, second=0, microsecond=0)
    if granularity == "week":
        day_start = ts.replace(hour=0, minute=0, second=0, microsecond=0)
        return day_start - timedelta(days=day_start.weekday())
    if granularity == "month":
        return ts.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return ts.replace(hour=0, minute=0, second=0, microsecond=0)


def _advance_bucket(ts: datetime, granularity: str) -> datetime:
    if granularity == "hour":
        return ts + timedelta(hours=1)
    if granularity == "week":
        return ts + timedelta(days=7)
    if granularity == "month":
        return (ts.replace(day=28) + timedelta(days=4)).replace(day=1)
    return ts + timedelta(days=1)


def _build_timeline(
    created_ats: List[datetime], period_start: datetime, period_end: datetime, granularity: str,
) -> List[TimelinePoint]:
    counts: "Counter[datetime]" = Counter(_truncate_to_bucket(ts, granularity) for ts in created_ats)

    buckets: List[datetime] = []
    cursor = _truncate_to_bucket(period_start, granularity)
    last_bucket = _truncate_to_bucket(period_end, granularity)
    while cursor <= last_bucket:
        buckets.append(cursor)
        cursor = _advance_bucket(cursor, granularity)

    return [TimelinePoint(bucket=b, count=counts.get(b, 0)) for b in buckets]


@router.get("/overview", response_model=StatisticsResponse)
async def get_statistics_overview(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
    period: str = Query("7d"),
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
) -> StatisticsResponse:
    if period not in _PERIODS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестный период")
    period_start, period_end = _period_bounds(period, start, end)

    result = await db.execute(
        select(Alert.title, Alert.description, Alert.status, Alert.created_at, Alert.raw_event)
        .where(
            Alert.is_deleted.is_(False),
            Alert.created_at >= period_start,
            Alert.created_at <= period_end,
        )
    )
    rows = result.all()

    status_counter: "Counter[str]" = Counter()
    threat_counter: "Counter[str]" = Counter()
    url_counter: "Counter[str]" = Counter()
    external_ip_counter: "Counter[str]" = Counter()
    internal_ip_counter: "Counter[str]" = Counter()
    account_counter: "Counter[str]" = Counter()
    file_counter: "Counter[str]" = Counter()
    # Per-threat-type breakdown for the report's "По типам угроз" table — which
    # IPs/accounts actually show up under each threat type, not just overall.
    threat_ip_counters: Dict[str, "Counter[str]"] = defaultdict(Counter)
    threat_account_counters: Dict[str, "Counter[str]"] = defaultdict(Counter)
    created_ats: List[datetime] = []

    for title, description, alert_status, created_at, raw_event in rows:
        status_counter[alert_status] += 1
        threat_type = classify_threat_type(title, description)
        threat_counter[threat_type] += 1
        created_ats.append(created_at)

        for url in resolve_urls(title, description, raw_event):
            url_counter[url] += 1

        for ip in resolve_ips(title, description, raw_event):
            if is_internal_ip(ip):
                internal_ip_counter[ip] += 1
            else:
                external_ip_counter[ip] += 1
            threat_ip_counters[threat_type][ip] += 1

        for account in resolve_accounts(title, description, raw_event):
            account_counter[account] += 1
            threat_account_counters[threat_type][account] += 1

        for file_name in resolve_files(title, description, raw_event):
            file_counter[file_name] += 1

    granularity = _timeline_granularity(period_start, period_end)

    return StatisticsResponse(
        period=StatisticsPeriod(start=period_start, end=period_end),
        total_alerts=len(rows),
        timeline=_build_timeline(created_ats, period_start, period_end, granularity),
        timeline_granularity=granularity,
        by_status=[StatusCount(status=s, count=c) for s, c in status_counter.most_common()],
        by_threat_type=[
            ThreatTypeCount(
                threat_type=t,
                count=c,
                top_ips=_top(threat_ip_counters[t], _THREAT_TYPE_DETAIL_TOP_N),
                top_accounts=_top(threat_account_counters[t], _THREAT_TYPE_DETAIL_TOP_N),
            )
            for t, c in threat_counter.most_common()
        ],
        top_urls=_top(url_counter),
        top_external_ips=_top(external_ip_counter),
        top_internal_ips=_top(internal_ip_counter),
        top_accounts=_top(account_counter),
        top_files=_top(file_counter),
    )


@router.get("/correlation-graph", response_model=CorrelationGraphResponse)
async def get_correlation_graph(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
    period: str = Query("7d"),
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    q: Optional[str] = Query(None, min_length=1),
) -> CorrelationGraphResponse:
    if period not in _PERIODS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестный период")
    period_start, period_end = _period_bounds(period, start, end)

    result = await db.execute(
        select(
            Alert.id, Alert.title, Alert.description, Alert.status, Alert.created_at, Alert.raw_event,
            Alert.case_id, Case.title,
        )
        .join(Case, Case.id == Alert.case_id, isouter=True)
        .where(
            Alert.is_deleted.is_(False),
            Alert.created_at >= period_start,
            Alert.created_at <= period_end,
        )
    )
    rows = result.all()

    entity_alerts: Dict[str, Dict[str, Set[str]]] = {"ip": {}, "account": {}, "file": {}, "ioc": {}}
    alert_info: Dict[str, Tuple[str, str, datetime]] = {}
    alert_case_title: Dict[str, Optional[str]] = {}
    alert_case_id: Dict[str, Optional[str]] = {}
    case_alert_ids: Dict[object, Set[str]] = {}

    for alert_id, title, description, alert_status, created_at, raw_event, case_id, case_title in rows:
        alert_id_str = str(alert_id)
        alert_info[alert_id_str] = (title, alert_status, created_at)
        alert_case_title[alert_id_str] = case_title
        alert_case_id[alert_id_str] = str(case_id) if case_id is not None else None
        if case_id is not None:
            case_alert_ids.setdefault(case_id, set()).add(alert_id_str)

        for ip in resolve_ips(title, description, raw_event):
            entity_alerts["ip"].setdefault(ip, set()).add(alert_id_str)
        for account in resolve_accounts(title, description, raw_event):
            entity_alerts["account"].setdefault(account, set()).add(alert_id_str)
        for file_name in resolve_files(title, description, raw_event):
            entity_alerts["file"].setdefault(file_name, set()).add(alert_id_str)

    # Curated IOCs recorded on each incident — a structured complement to the
    # ip/account/file values scraped from alert text above.
    if case_alert_ids:
        ioc_result = await db.execute(
            select(IOC.case_id, IOC.ioc_type, IOC.value).where(IOC.case_id.in_(case_alert_ids.keys()))
        )
        for ioc_case_id, ioc_type, ioc_value in ioc_result.all():
            kind = _IOC_KIND_MAP.get(ioc_type)
            if not kind:
                continue
            for alert_id_str in case_alert_ids.get(ioc_case_id, ()):
                entity_alerts[kind].setdefault(ioc_value, set()).add(alert_id_str)

    truncated = False
    nodes: List[GraphNode] = []
    edges: List[GraphEdge] = []
    included_alert_ids: Set[str] = set()

    try:
        kql_ast = parse_kql(q) if q else None
    except KqlSyntaxError:
        # Malformed query — degrade to the default overview graph rather
        # than a 500. AnalysisPage validates the same grammar client-side
        # and blocks the search button on a bad query, so this only fires
        # for a direct API call with a broken `q`.
        kql_ast = None

    if kql_ast is not None:
        def _matches(text: Optional[str]) -> bool:
            return evaluate_text(kql_ast, lambda term, quoted: matches_text(term, quoted, text))

        # Alerts whose own title, or their parent incident's title, matches
        # the query are "seed" alerts — always shown, even with no IOCs yet.
        seed_alert_ids: Set[str] = {
            alert_id for alert_id, (title, _status, _created) in alert_info.items()
            if _matches(title)
        }
        seed_alert_ids |= {
            alert_id for alert_id, case_title in alert_case_title.items()
            if case_title and _matches(case_title)
        }

        # Targeted search: match any ip/account/file whose value contains the
        # query, including values that only occur in a single alert — the
        # point here is "show me this specific value", not "show me noise".
        # Entities touching a seed alert are pulled in too, so a name search
        # also surfaces what that alert (or incident) correlates with.
        for kind in entity_alerts:
            matches = {
                v: ids for v, ids in entity_alerts[kind].items()
                if _matches(v) or ids & seed_alert_ids
            }
            if _emit_entity_nodes(
                matches, kind, _SEARCH_ENTITY_CAP, _SEARCH_MAX_ALERTS_PER_ENTITY,
                alert_info, nodes, edges, included_alert_ids,
            ):
                truncated = True

        included_alert_ids |= seed_alert_ids
    else:
        # Default overview: only entities shared across 2+ alerts represent
        # an actual correlation, capped to the noisiest per kind.
        for kind in entity_alerts:
            shared = {v: ids for v, ids in entity_alerts[kind].items() if len(ids) >= 2}
            if _emit_entity_nodes(
                shared, kind, _ENTITY_TOP_N[kind], _MAX_ALERTS_PER_ENTITY,
                alert_info, nodes, edges, included_alert_ids,
            ):
                truncated = True

    for alert_id_str in included_alert_ids:
        title, alert_status, _ = alert_info[alert_id_str]
        nodes.append(GraphNode(
            id=alert_id_str, kind="alert", label=title, status=alert_status,
            case_id=alert_case_id.get(alert_id_str),
        ))

    return CorrelationGraphResponse(
        period=StatisticsPeriod(start=period_start, end=period_end),
        nodes=nodes,
        edges=edges,
        truncated=truncated,
    )
