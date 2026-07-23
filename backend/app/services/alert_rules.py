import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.models import (
    Alert, AlertRule, AlertRuleAction, AlertStatus, Branch, BranchStatus,
    Case, CaseParticipant, CaseSeverity, CaseStatus, ConfidenceLevel, Event, EventType,
)


@dataclass
class MatchCriteria:
    """Duck-types the match_* fields of AlertRule so matching logic can run
    against either a persisted rule or an in-progress (not-yet-saved) form."""
    match_source: Optional[str] = None
    match_severity: Optional[CaseSeverity] = None
    match_title_contains: Optional[str] = None
    match_description_contains: Optional[str] = None


def _matches(alert: Alert, rule: MatchCriteria) -> bool:
    if rule.match_source and (alert.source or "").strip().casefold() != rule.match_source.strip().casefold():
        return False
    if rule.match_severity and alert.severity != rule.match_severity:
        return False
    if rule.match_title_contains and rule.match_title_contains.casefold() not in (alert.title or "").casefold():
        return False
    if (
        rule.match_description_contains
        and rule.match_description_contains.casefold() not in (alert.description or "").casefold()
    ):
        return False
    return True


async def count_matching_alerts(db: AsyncSession, criteria: MatchCriteria) -> int:
    """Preview how many currently-active alerts satisfy a set of match criteria."""
    result = await db.execute(select(Alert).where(Alert.is_deleted.is_(False)))
    alerts = result.scalars().all()
    return sum(1 for alert in alerts if _matches(alert, criteria))


def _event_from_alert(alert: Alert, branch_id: uuid.UUID, sort_order: int, created_by: Optional[uuid.UUID]) -> Event:
    return Event(
        branch_id=branch_id,
        event_ts=alert.created_at,
        event_type=EventType.detection,
        title=alert.title,
        description=alert.description,
        source_description=alert.source,
        confidence_level=ConfidenceLevel.corroborated,
        sort_order=sort_order,
        created_by=created_by,
    )


async def _escalate_to_new_case(db: AsyncSession, alert: Alert, actor_user_id: Optional[uuid.UUID]) -> Case:
    case = Case(
        title=alert.title,
        severity=alert.severity,
        status=CaseStatus.open,
        ir_lead_id=actor_user_id,
    )
    db.add(case)
    await db.flush()

    main_branch = Branch(
        case_id=case.id,
        name="Main Timeline",
        is_main=True,
        status=BranchStatus.confirmed,
        created_by=actor_user_id,
    )
    db.add(main_branch)
    await db.flush()

    if actor_user_id is not None:
        db.add(CaseParticipant(case_id=case.id, user_id=actor_user_id))

    alert.status = AlertStatus.escalated
    alert.case_id = case.id
    db.add(_event_from_alert(alert, main_branch.id, 0, actor_user_id))
    await db.flush()
    return case


async def _escalate_to_existing_case(
    db: AsyncSession, alert: Alert, case_id: uuid.UUID, actor_user_id: Optional[uuid.UUID]
) -> None:
    result = await db.execute(
        select(Branch).where(Branch.case_id == case_id, Branch.is_main.is_(True))
    )
    main_branch = result.scalar_one_or_none()
    if main_branch is None:
        return

    count_result = await db.execute(select(Event.id).where(Event.branch_id == main_branch.id))
    sort_order = len(list(count_result.scalars().all()))

    alert.status = AlertStatus.escalated
    alert.case_id = case_id
    db.add(_event_from_alert(alert, main_branch.id, sort_order, actor_user_id))
    await db.flush()


async def _apply(
    db: AsyncSession, rule: AlertRule, alert: Alert, actor_user_id: Optional[uuid.UUID]
) -> None:
    if rule.action == AlertRuleAction.suppress:
        alert.status = AlertStatus.dismissed
    elif rule.target_case_id is not None:
        await _escalate_to_existing_case(db, alert, rule.target_case_id, actor_user_id)
    else:
        await _escalate_to_new_case(db, alert, actor_user_id)

    rule.applied_count += 1
    rule.last_applied_at = datetime.now(timezone.utc)

    await log_action(
        db=db,
        user_id=actor_user_id,
        case_id=alert.case_id,
        action="auto_apply_rule",
        object_type="alert",
        object_id=str(alert.id),
        details={"rule_id": str(rule.id), "rule_name": rule.name, "action": rule.action.value},
    )
    await db.flush()


async def apply_matching_rules(
    db: AsyncSession, alert: Alert, actor_user_id: Optional[uuid.UUID] = None
) -> Optional[AlertRule]:
    """Run enabled rules (oldest first) against a single alert; apply the first match."""
    result = await db.execute(
        select(AlertRule).where(AlertRule.is_enabled.is_(True)).order_by(AlertRule.created_at.asc())
    )
    for rule in result.scalars().all():
        if _matches(alert, rule):
            await _apply(db, rule, alert, actor_user_id)
            return rule
    return None


async def apply_rule_to_alerts(
    db: AsyncSession, rule: AlertRule, alerts: List[Alert], actor_user_id: Optional[uuid.UUID]
) -> int:
    """Force-apply a rule's action to an explicit set of alerts, regardless of match."""
    applied = 0
    for alert in alerts:
        if alert.status == AlertStatus.escalated:
            continue
        await _apply(db, rule, alert, actor_user_id)
        applied += 1
    return applied
