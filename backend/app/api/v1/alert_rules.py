import uuid
from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.rbac import require_write_access
from app.database import get_db
from app.models import Alert, AlertRule, User
from app.schemas import (
    AlertRuleCreate, AlertRuleFromSelectionRequest, AlertRuleFromSelectionResponse,
    AlertRuleMatchPreviewRequest, AlertRuleMatchPreviewResponse, AlertRuleResponse, AlertRuleUpdate,
)
from app.services.alert_rules import MatchCriteria, apply_rule_to_alerts, count_matching_alerts

router = APIRouter(prefix="/alert-rules", tags=["alert-rules"])


async def _get_rule_or_404(rule_id: uuid.UUID, db: AsyncSession) -> AlertRule:
    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert rule not found")
    return rule


@router.get("", response_model=List[AlertRuleResponse])
async def list_alert_rules(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_write_access)],
) -> List[AlertRule]:
    result = await db.execute(select(AlertRule).order_by(AlertRule.created_at.desc()))
    return list(result.scalars().all())


@router.post("", response_model=AlertRuleResponse, status_code=status.HTTP_201_CREATED)
async def create_alert_rule(
    payload: AlertRuleCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_write_access)],
) -> AlertRule:
    rule = AlertRule(**payload.model_dump(), created_by=current_user.id)
    db.add(rule)
    await db.flush()

    await log_action(
        db=db, user_id=current_user.id, case_id=None,
        action="create", object_type="alert_rule", object_id=str(rule.id),
        details={"name": rule.name, "action": rule.action.value}, request=request,
    )

    await db.flush()
    await db.refresh(rule)
    return rule


@router.put("/{rule_id}", response_model=AlertRuleResponse)
async def update_alert_rule(
    rule_id: uuid.UUID,
    payload: AlertRuleUpdate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_write_access)],
) -> AlertRule:
    rule = await _get_rule_or_404(rule_id, db)
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(rule, field, value)

    await log_action(
        db=db, user_id=current_user.id, case_id=None,
        action="update", object_type="alert_rule", object_id=str(rule.id),
        details=update_data, request=request,
    )

    await db.flush()
    await db.refresh(rule)
    return rule


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert_rule(
    rule_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_write_access)],
) -> None:
    rule = await _get_rule_or_404(rule_id, db)

    await log_action(
        db=db, user_id=current_user.id, case_id=None,
        action="delete", object_type="alert_rule", object_id=str(rule.id),
        details={"name": rule.name}, request=request,
    )

    await db.delete(rule)
    await db.flush()


@router.post("/from-selection", response_model=AlertRuleFromSelectionResponse, status_code=status.HTTP_201_CREATED)
async def create_alert_rule_from_selection(
    payload: AlertRuleFromSelectionRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_write_access)],
) -> AlertRuleFromSelectionResponse:
    rule = AlertRule(
        name=payload.name,
        match_source=payload.match_source,
        match_severity=payload.match_severity,
        match_title_contains=payload.match_title_contains,
        match_description_contains=payload.match_description_contains,
        action=payload.action,
        target_case_id=payload.target_case_id,
        created_by=current_user.id,
    )
    db.add(rule)
    await db.flush()

    result = await db.execute(select(Alert).where(Alert.id.in_(payload.alert_ids)))
    alerts = list(result.scalars().all())
    applied_count = await apply_rule_to_alerts(db, rule, alerts, current_user.id)

    await log_action(
        db=db, user_id=current_user.id, case_id=None,
        action="create_from_selection", object_type="alert_rule", object_id=str(rule.id),
        details={"name": rule.name, "alert_ids": [str(a.id) for a in alerts], "applied_count": applied_count},
        request=request,
    )

    await db.flush()
    await db.refresh(rule)
    return AlertRuleFromSelectionResponse(rule=AlertRuleResponse.model_validate(rule), applied_count=applied_count)


@router.post("/preview-matches", response_model=AlertRuleMatchPreviewResponse)
async def preview_alert_rule_matches(
    payload: AlertRuleMatchPreviewRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_write_access)],
) -> AlertRuleMatchPreviewResponse:
    """Live preview: how many currently-active alerts satisfy a set of match
    criteria, without persisting a rule or touching any alert."""
    criteria = MatchCriteria(
        match_source=payload.match_source,
        match_severity=payload.match_severity,
        match_title_contains=payload.match_title_contains,
        match_description_contains=payload.match_description_contains,
    )
    matching_count = await count_matching_alerts(db, criteria)
    return AlertRuleMatchPreviewResponse(matching_count=matching_count)
