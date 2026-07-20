import uuid
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_action
from app.core.auth import get_current_active_user
from app.core.rbac import require_write_access
from app.database import get_db
from app.models import (
    Alert, AlertStatus, Branch, BranchStatus, Case, CaseParticipant,
    CaseSeverity, CaseStatus, ConfidenceLevel, Event, EventType, User,
)
from app.schemas import (
    AlertBulkEscalateRequest, AlertCreate, AlertEscalateRequest, AlertResponse, AlertUpdate,
    CaseResponse,
)

_SEVERITY_ORDER = [
    CaseSeverity.critical, CaseSeverity.high, CaseSeverity.medium,
    CaseSeverity.low, CaseSeverity.informational,
]

router = APIRouter(prefix="/alerts", tags=["alerts"])


def _case_options():
    return (
        selectinload(Case.ir_lead),
        selectinload(Case.participants).selectinload(CaseParticipant.user),
    )


def _event_from_alert(alert: Alert, branch_id: uuid.UUID, sort_order: int, created_by: uuid.UUID) -> Event:
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


async def _get_alert_or_404(alert_id: uuid.UUID, db: AsyncSession) -> Alert:
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    return alert


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[AlertResponse])
async def list_alerts(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
    alert_status: Optional[AlertStatus] = Query(None, alias="status"),
    severity: Optional[CaseSeverity] = None,
    case_id: Optional[uuid.UUID] = None,
    skip: int = 0,
    limit: int = 50,
) -> List[Alert]:
    query = select(Alert)
    if alert_status:
        query = query.where(Alert.status == alert_status)
    if severity:
        query = query.where(Alert.severity == severity)
    if case_id:
        query = query.where(Alert.case_id == case_id)
    query = query.order_by(Alert.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("", response_model=AlertResponse, status_code=status.HTTP_201_CREATED)
async def create_alert(
    payload: AlertCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> Alert:
    alert = Alert(
        title=payload.title,
        description=payload.description,
        severity=payload.severity,
        source=payload.source,
        status=AlertStatus.new,
        created_by=current_user.id,
    )
    db.add(alert)
    await db.flush()

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=None,
        action="create",
        object_type="alert",
        object_id=str(alert.id),
        details={"title": alert.title, "severity": alert.severity.value},
        request=request,
    )

    await db.flush()
    await db.refresh(alert)
    return alert


# ── Bulk escalate to a single case ───────────────────────────────────────────

@router.post("/escalate-bulk", response_model=CaseResponse, status_code=status.HTTP_201_CREATED)
async def escalate_alerts_bulk(
    payload: AlertBulkEscalateRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_write_access)],
) -> Case:
    alert_ids = set(payload.alert_ids)
    result = await db.execute(select(Alert).where(Alert.id.in_(alert_ids)))
    alerts = list(result.scalars().all())

    if len(alerts) != len(alert_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more alerts not found")
    if any(a.status == AlertStatus.escalated and a.case_id is not None for a in alerts):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="One or more alerts already escalated")

    severity = min(
        (a.severity for a in alerts),
        key=lambda s: _SEVERITY_ORDER.index(s),
    )
    title = payload.title or f"Дело из {len(alerts)} алертов: " + ", ".join(a.title for a in alerts[:3])

    case = Case(
        title=title,
        severity=severity,
        status=CaseStatus.open,
        ir_lead_id=current_user.id,
        classification=payload.classification,
        confidentiality_label=payload.confidentiality_label,
        external_ticket_id=payload.external_ticket_id,
    )
    db.add(case)
    await db.flush()

    main_branch = Branch(
        case_id=case.id,
        name="Main Timeline",
        is_main=True,
        status=BranchStatus.confirmed,
        created_by=current_user.id,
    )
    db.add(main_branch)
    await db.flush()

    participant = CaseParticipant(
        case_id=case.id,
        user_id=current_user.id,
        role_in_case=current_user.role,
    )
    db.add(participant)

    for idx, alert in enumerate(alerts):
        alert.status = AlertStatus.escalated
        alert.case_id = case.id
        db.add(_event_from_alert(alert, main_branch.id, idx, current_user.id))

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=case.id,
        action="escalate_from_alerts_bulk",
        object_type="case",
        object_id=str(case.id),
        details={"alert_ids": [str(a.id) for a in alerts]},
        request=request,
    )

    await db.flush()
    result = await db.execute(
        select(Case).options(*_case_options()).where(Case.id == case.id)
    )
    return result.scalar_one()


# ── Read ──────────────────────────────────────────────────────────────────────

@router.get("/{alert_id}", response_model=AlertResponse)
async def get_alert(
    alert_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> Alert:
    return await _get_alert_or_404(alert_id, db)


# ── Update (triage / dismiss / edit) ─────────────────────────────────────────

@router.put("/{alert_id}", response_model=AlertResponse)
async def update_alert(
    alert_id: uuid.UUID,
    payload: AlertUpdate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_write_access)],
) -> Alert:
    alert = await _get_alert_or_404(alert_id, db)

    if payload.status == AlertStatus.escalated:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use POST /alerts/{id}/escalate to escalate an alert into a case",
        )

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(alert, field, value)

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=alert.case_id,
        action="update",
        object_type="alert",
        object_id=str(alert.id),
        details=update_data,
        request=request,
    )

    await db.flush()
    await db.refresh(alert)
    return alert


# ── Escalate to case ─────────────────────────────────────────────────────────

@router.post("/{alert_id}/escalate", response_model=CaseResponse, status_code=status.HTTP_201_CREATED)
async def escalate_alert(
    alert_id: uuid.UUID,
    payload: AlertEscalateRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_write_access)],
) -> Case:
    alert = await _get_alert_or_404(alert_id, db)

    if alert.status == AlertStatus.escalated and alert.case_id is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Alert already escalated")

    case = Case(
        title=alert.title,
        severity=alert.severity,
        status=CaseStatus.open,
        ir_lead_id=current_user.id,
        classification=payload.classification,
        confidentiality_label=payload.confidentiality_label,
        external_ticket_id=payload.external_ticket_id,
    )
    db.add(case)
    await db.flush()

    main_branch = Branch(
        case_id=case.id,
        name="Main Timeline",
        is_main=True,
        status=BranchStatus.confirmed,
        created_by=current_user.id,
    )
    db.add(main_branch)
    await db.flush()

    participant = CaseParticipant(
        case_id=case.id,
        user_id=current_user.id,
        role_in_case=current_user.role,
    )
    db.add(participant)

    alert.status = AlertStatus.escalated
    alert.case_id = case.id
    db.add(_event_from_alert(alert, main_branch.id, 0, current_user.id))

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=case.id,
        action="escalate_from_alert",
        object_type="case",
        object_id=str(case.id),
        details={"alert_id": str(alert.id)},
        request=request,
    )

    await db.flush()
    result = await db.execute(
        select(Case).options(*_case_options()).where(Case.id == case.id)
    )
    return result.scalar_one()


# ── Detach from case ─────────────────────────────────────────────────────────

@router.post("/{alert_id}/detach", response_model=AlertResponse)
async def detach_alert(
    alert_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_write_access)],
) -> Alert:
    alert = await _get_alert_or_404(alert_id, db)

    if alert.case_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Alert is not attached to a case")

    old_case_id = alert.case_id
    alert.case_id = None
    alert.status = AlertStatus.triaged

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=old_case_id,
        action="detach_from_case",
        object_type="alert",
        object_id=str(alert.id),
        details={"case_id": str(old_case_id)},
        request=request,
    )

    await db.flush()
    await db.refresh(alert)
    return alert
