import uuid
from datetime import datetime, timezone
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_action
from app.core.auth import get_current_active_user
from app.core.rbac import has_permission, require_case_access, require_manage_cases
from app.database import get_db
from app.models import (
    AuditLog, Branch, BranchStatus, Case, CaseParticipant,
    CaseSeverity, CaseStatus, IOC, User, UserRole,
)
from app.schemas import (
    AuditLogEntry, CaseAttachRequest, CaseCreate, CaseDeleteRequest, CaseParticipantAdd,
    CaseParticipantResponse, CaseResponse, CaseUpdate,
)

router = APIRouter(prefix="/cases", tags=["cases"])


def _case_options():
    return (
        selectinload(Case.ir_lead),
        selectinload(Case.participants).selectinload(CaseParticipant.user),
        selectinload(Case.parent_case),
        selectinload(Case.attached_cases),
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
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
    case_status: Optional[List[CaseStatus]] = Query(None, alias="status"),
    severity: Optional[CaseSeverity] = None,
    ir_lead_id: Optional[uuid.UUID] = None,
    q: Optional[str] = Query(None, min_length=1),
    archived: Optional[bool] = None,
    skip: int = 0,
    limit: int = 50,
) -> List[Case]:
    filters = [Case.is_deleted == False]  # noqa: E712
    filters.append(Case.is_archived == (archived if archived is not None else False))

    # Users without view_all_cases see only cases where they participate
    if current_user.role != UserRole.admin and not await has_permission(db, current_user.role, "view_all_cases"):
        subq = (
            select(CaseParticipant.case_id)
            .where(CaseParticipant.user_id == current_user.id)
            .scalar_subquery()
        )
        filters.append(Case.id.in_(subq))

    if case_status:
        filters.append(Case.status.in_(case_status))
    if severity:
        filters.append(Case.severity == severity)
    if ir_lead_id:
        filters.append(Case.ir_lead_id == ir_lead_id)
    if q:
        pattern = f"%{q.strip()}%"
        ioc_case_ids = select(IOC.case_id).where(IOC.value.ilike(pattern)).scalar_subquery()
        filters.append(
            or_(
                Case.title.ilike(pattern),
                cast(Case.id, String).ilike(pattern),
                Case.id.in_(ioc_case_ids),
            )
        )

    count_result = await db.execute(select(func.count()).select_from(select(Case.id).where(*filters).subquery()))
    response.headers["X-Total-Count"] = str(count_result.scalar_one())

    query = (
        select(Case)
        .options(*_case_options())
        .where(*filters)
        .order_by(Case.created_at.desc(), Case.id.desc()).offset(skip).limit(limit)
    )
    result = await db.execute(query)
    return list(result.scalars().all())


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("", response_model=CaseResponse, status_code=status.HTTP_201_CREATED)
async def create_case(
    payload: CaseCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_manage_cases)],
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

    if current_user.role != UserRole.admin and not await has_permission(db, current_user.role, "manage_cases"):
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
        # JSON-safe copy for the JSONB audit column — update_data itself may
        # hold raw UUID/datetime values (e.g. ir_lead_id), which the default
        # json encoder can't serialize.
        details=payload.model_dump(exclude_unset=True, mode="json"),
        request=request,
    )

    await db.flush()
    result = await db.execute(
        select(Case).options(*_case_options()).where(Case.id == case.id)
    )
    return result.scalar_one()


# ── Archive ──────────────────────────────────────────────────────────────────

@router.post("/{case_id}/archive", response_model=CaseResponse)
async def archive_case(
    case_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_manage_cases)],
) -> Case:
    case = await _get_case_or_404(case_id, db)
    case.is_archived = True
    case.archived_at = datetime.now(timezone.utc)
    case.archived_by = current_user.id

    await log_action(
        db=db, user_id=current_user.id, case_id=case.id,
        action="archive", object_type="case", object_id=str(case.id),
        request=request,
    )
    await db.flush()
    await db.refresh(case)
    return await _get_case_or_404(case.id, db)


@router.post("/{case_id}/unarchive", response_model=CaseResponse)
async def unarchive_case(
    case_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_manage_cases)],
) -> Case:
    case = await _get_case_or_404(case_id, db)
    case.is_archived = False
    case.archived_at = None
    case.archived_by = None

    await log_action(
        db=db, user_id=current_user.id, case_id=case.id,
        action="unarchive", object_type="case", object_id=str(case.id),
        request=request,
    )
    await db.flush()
    await db.refresh(case)
    return await _get_case_or_404(case.id, db)


# ── Delete (soft) ─────────────────────────────────────────────────────────────

@router.delete("/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_case(
    case_id: uuid.UUID,
    payload: CaseDeleteRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_manage_cases)],
) -> None:
    case = await _get_case_or_404(case_id, db)
    if not case.is_archived:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Инцидент нужно сначала архивировать, прежде чем удалять",
        )
    reason = payload.reason.strip()
    case.is_deleted = True
    case.delete_reason = reason

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=case.id,
        action="delete",
        object_type="case",
        object_id=str(case.id),
        details={"reason": reason},
        request=request,
    )
    await db.flush()


# ── Attach / detach ─────────────────────────────────────────────────────────────
# "Присоединить": links this case to another as its main incident (or makes
# it the main for the other, per main_case_id) — a lightweight one-level
# grouping, not a data merge. A case can only be attached to one main case at
# a time; a main case can have many attached cases.

@router.post("/{case_id}/attach", response_model=CaseResponse)
async def attach_case(
    case_id: uuid.UUID,
    payload: CaseAttachRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_manage_cases)],
) -> Case:
    if payload.other_case_id == case_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя присоединить инцидент к самому себе",
        )
    if payload.main_case_id not in (case_id, payload.other_case_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Главный инцидент должен быть одним из двух выбранных",
        )

    case = await _get_case_or_404(case_id, db)
    other = await _get_case_or_404(payload.other_case_id, db)
    main, child = (case, other) if payload.main_case_id == case_id else (other, case)

    if child.parent_case_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Инцидент «{child.title}» уже присоединён к другому инциденту — сначала отсоедините",
        )
    if main.parent_case_id == child.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя присоединить инцидент к своему же дочернему инциденту",
        )

    reason = payload.reason.strip()
    child.parent_case_id = main.id
    child.attach_reason = reason

    await log_action(
        db=db, user_id=current_user.id, case_id=child.id,
        action="attach", object_type="case", object_id=str(child.id),
        details={"main_case_id": str(main.id), "reason": reason}, request=request,
    )

    await db.flush()
    return await _get_case_or_404(case_id, db)


@router.post("/{case_id}/detach", response_model=CaseResponse)
async def detach_case(
    case_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_manage_cases)],
) -> Case:
    case = await _get_case_or_404(case_id, db)
    if case.parent_case_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Инцидент не присоединён к другому",
        )
    previous_main_id = case.parent_case_id
    case.parent_case_id = None
    case.attach_reason = None

    await log_action(
        db=db, user_id=current_user.id, case_id=case.id,
        action="detach", object_type="case", object_id=str(case.id),
        details={"previous_main_case_id": str(previous_main_id)}, request=request,
    )

    await db.flush()
    return await _get_case_or_404(case_id, db)


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
    current_user: Annotated[User, Depends(require_manage_cases)],
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
    current_user: Annotated[User, Depends(require_manage_cases)],
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

    if current_user.role != UserRole.admin and not await has_permission(db, current_user.role, "manage_cases"):
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
