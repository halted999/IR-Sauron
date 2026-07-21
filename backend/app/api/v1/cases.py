import uuid
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_action
from app.core.auth import get_current_active_user
from app.core.rbac import require_admin_or_lead, require_case_access
from app.database import get_db
from app.models import (
    AuditLog, Branch, BranchStatus, Case, CaseParticipant,
    CaseSeverity, CaseStatus, User, UserRole,
)
from app.schemas import (
    AuditLogEntry, CaseCreate, CaseParticipantAdd,
    CaseParticipantResponse, CaseResponse, CaseUpdate,
)

router = APIRouter(prefix="/cases", tags=["cases"])


def _case_options():
    return (
        selectinload(Case.ir_lead),
        selectinload(Case.participants).selectinload(CaseParticipant.user),
    )


async def _get_case_or_404(case_id: uuid.UUID, db: AsyncSession) -> Case:
    result = await db.execute(
        select(Case)
        .options(*_case_options())
        .where(Case.id == case_id, Case.is_deleted == False)
    )
    case = result.scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")
    return case


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[CaseResponse])
async def list_cases(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
    case_status: Optional[CaseStatus] = Query(None, alias="status"),
    severity: Optional[CaseSeverity] = None,
    ir_lead_id: Optional[uuid.UUID] = None,
    skip: int = 0,
    limit: int = 50,
) -> List[Case]:
    query = (
        select(Case)
        .options(*_case_options())
        .where(Case.is_deleted == False)
    )

    # Non-admin/lead users see only cases where they participate
    if current_user.role not in (UserRole.admin, UserRole.ir_lead):
        subq = (
            select(CaseParticipant.case_id)
            .where(CaseParticipant.user_id == current_user.id)
            .scalar_subquery()
        )
        query = query.where(Case.id.in_(subq))

    if case_status:
        query = query.where(Case.status == case_status)
    if severity:
        query = query.where(Case.severity == severity)
    if ir_lead_id:
        query = query.where(Case.ir_lead_id == ir_lead_id)

    query = query.order_by(Case.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("", response_model=CaseResponse, status_code=status.HTTP_201_CREATED)
async def create_case(
    payload: CaseCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin_or_lead)],
) -> Case:
    case = Case(
        title=payload.title,
        severity=payload.severity,
        status=CaseStatus.open,
        ir_lead_id=payload.ir_lead_id or current_user.id,
        classification=payload.classification,
        confidentiality_label=payload.confidentiality_label,
        external_ticket_id=payload.external_ticket_id,
        incident_discovered_at=payload.incident_discovered_at,
    )
    db.add(case)
    await db.flush()

    # Automatically create the main branch
    main_branch = Branch(
        case_id=case.id,
        name="Main Timeline",
        is_main=True,
        status=BranchStatus.confirmed,
        created_by=current_user.id,
    )
    db.add(main_branch)

    # Add the creator as a participant
    participant = CaseParticipant(
        case_id=case.id,
        user_id=current_user.id,
        role_in_case=current_user.role,
    )
    db.add(participant)

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=case.id,
        action="create",
        object_type="case",
        object_id=str(case.id),
        details={"title": case.title, "severity": case.severity.value},
        request=request,
    )

    await db.flush()
    await db.refresh(case, attribute_names=["ir_lead", "participants"])
    # Reload participants with user info
    result = await db.execute(
        select(Case).options(*_case_options()).where(Case.id == case.id)
    )
    return result.scalar_one()


# ── Read ──────────────────────────────────────────────────────────────────────

@router.get("/{case_id}", response_model=CaseResponse)
async def get_case(
    case_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> Case:
    case = await _get_case_or_404(case_id, db)
    await require_case_access(case_id, current_user, db)
    return case


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/{case_id}", response_model=CaseResponse)
async def update_case(
    case_id: uuid.UUID,
    payload: CaseUpdate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> Case:
    case = await _get_case_or_404(case_id, db)
    await require_case_access(case_id, current_user, db)

    if current_user.role not in (UserRole.admin, UserRole.ir_lead):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(case, field, value)

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=case.id,
        action="update",
        object_type="case",
        object_id=str(case.id),
        details=update_data,
        request=request,
    )

    await db.flush()
    result = await db.execute(
        select(Case).options(*_case_options()).where(Case.id == case.id)
    )
    return result.scalar_one()


# ── Delete (soft) ─────────────────────────────────────────────────────────────

@router.delete("/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_case(
    case_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin_or_lead)],
) -> None:
    case = await _get_case_or_404(case_id, db)
    case.is_deleted = True
    case.status = CaseStatus.closed

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=case.id,
        action="delete",
        object_type="case",
        object_id=str(case.id),
        request=request,
    )
    await db.flush()


# ── Participants ───────────────────────────────────────────────────────────────

@router.post(
    "/{case_id}/participants",
    response_model=CaseParticipantResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_participant(
    case_id: uuid.UUID,
    payload: CaseParticipantAdd,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin_or_lead)],
) -> CaseParticipant:
    await _get_case_or_404(case_id, db)

    # Check user exists
    user_res = await db.execute(select(User).where(User.id == payload.user_id))
    target_user = user_res.scalar_one_or_none()
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Check not already a participant
    existing = await db.execute(
        select(CaseParticipant).where(
            CaseParticipant.case_id == case_id,
            CaseParticipant.user_id == payload.user_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already a participant",
        )

    participant = CaseParticipant(
        case_id=case_id,
        user_id=payload.user_id,
        role_in_case=payload.role_in_case,
    )
    db.add(participant)

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=case_id,
        action="add_participant",
        object_type="case_participant",
        object_id=str(payload.user_id),
        request=request,
    )

    await db.flush()
    await db.refresh(participant, attribute_names=["user"])
    return participant


@router.delete("/{case_id}/participants/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_participant(
    case_id: uuid.UUID,
    user_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin_or_lead)],
) -> None:
    await _get_case_or_404(case_id, db)

    result = await db.execute(
        select(CaseParticipant).where(
            CaseParticipant.case_id == case_id,
            CaseParticipant.user_id == user_id,
        )
    )
    participant = result.scalar_one_or_none()
    if participant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")

    await db.delete(participant)

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=case_id,
        action="remove_participant",
        object_type="case_participant",
        object_id=str(user_id),
        request=request,
    )
    await db.flush()


# ── Audit log ─────────────────────────────────────────────────────────────────

@router.get("/{case_id}/audit", response_model=List[AuditLogEntry])
async def get_audit_log(
    case_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
    skip: int = 0,
    limit: int = 200,
) -> List[AuditLog]:
    await _get_case_or_404(case_id, db)

    if current_user.role not in (UserRole.admin, UserRole.ir_lead):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    result = await db.execute(
        select(AuditLog)
        .where(AuditLog.case_id == case_id)
        .order_by(AuditLog.ts.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(result.scalars().all())


# ── Export ────────────────────────────────────────────────────────────────────

@router.get("/{case_id}/export")
async def export_case(
    case_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> dict:
    from sqlalchemy.orm import selectinload as sl
    from app.models import Event

    await require_case_access(case_id, current_user, db)

    result = await db.execute(
        select(Case)
        .options(
            sl(Case.ir_lead),
            sl(Case.participants).selectinload(CaseParticipant.user),
            sl(Case.branches).selectinload(Branch.events).selectinload(Event.artifacts),
            sl(Case.branches).selectinload(Branch.events).selectinload(Event.ioc_links),
            sl(Case.iocs),
        )
        .where(Case.id == case_id, Case.is_deleted == False)
    )
    case = result.scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")

    def _dt(dt):
        return dt.isoformat() if dt else None

    export_data = {
        "case": {
            "id": str(case.id),
            "title": case.title,
            "status": case.status.value,
            "severity": case.severity.value,
            "classification": case.classification,
            "confidentiality_label": case.confidentiality_label,
            "external_ticket_id": case.external_ticket_id,
            "incident_discovered_at": _dt(case.incident_discovered_at),
            "incident_started_at": _dt(case.incident_started_at),
            "incident_contained_at": _dt(case.incident_contained_at),
            "incident_closed_at": _dt(case.incident_closed_at),
            "created_at": _dt(case.created_at),
        },
        "branches": [],
        "iocs": [],
    }

    for branch in case.branches:
        branch_data = {
            "id": str(branch.id),
            "name": branch.name,
            "is_main": branch.is_main,
            "status": branch.status.value,
            "events": [],
        }
        for event in sorted(branch.events, key=lambda e: (e.event_ts or e.created_at, e.sort_order)):
            if event.is_deleted:
                continue
            branch_data["events"].append({
                "id": str(event.id),
                "event_ts": _dt(event.event_ts),
                "event_type": event.event_type.value,
                "title": event.title,
                "description": event.description,
                "source_description": event.source_description,
                "confidence_level": event.confidence_level.value,
                "mitre_tactic": event.mitre_tactic,
                "mitre_technique": event.mitre_technique,
                "mitre_subtechnique": event.mitre_subtechnique,
                "artifacts": [
                    {"id": str(a.id), "file_name": a.file_name, "sha256": a.sha256}
                    for a in event.artifacts
                ],
            })
        export_data["branches"].append(branch_data)

    for ioc in case.iocs:
        export_data["iocs"].append({
            "id": str(ioc.id),
            "ioc_type": ioc.ioc_type,
            "value": ioc.value,
            "context": ioc.context,
        })

    return export_data
