import uuid
from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_active_user
from app.core.rbac import require_case_access, require_case_write_access
from app.database import get_db
from app.models import Case, Event, EventIOC, IOC, User
from app.schemas import IOCCreate, IOCResponse, MessageResponse

router = APIRouter(tags=["iocs"])


async def _get_case_or_404(case_id: uuid.UUID, db: AsyncSession) -> Case:
    result = await db.execute(
        select(Case).where(Case.id == case_id, Case.is_deleted == False)
    )
    case = result.scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")
    return case


async def _get_ioc_or_404(ioc_id: uuid.UUID, db: AsyncSession) -> IOC:
    result = await db.execute(select(IOC).where(IOC.id == ioc_id))
    ioc = result.scalar_one_or_none()
    if ioc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="IOC not found")
    return ioc


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/iocs", response_model=List[IOCResponse])
async def list_iocs(
    case_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
    skip: int = 0,
    limit: int = 200,
) -> List[IOC]:
    await _get_case_or_404(case_id, db)
    await require_case_access(case_id, current_user, db)

    result = await db.execute(
        select(IOC)
        .where(IOC.case_id == case_id)
        .order_by(IOC.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(result.scalars().all())


# ── Create ────────────────────────────────────────────────────────────────────

@router.post(
    "/cases/{case_id}/iocs",
    response_model=IOCResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_ioc(
    case_id: uuid.UUID,
    payload: IOCCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> IOC:
    await _get_case_or_404(case_id, db)
    await require_case_write_access(case_id, current_user, db)

    ioc = IOC(
        case_id=case_id,
        ioc_type=payload.ioc_type,
        value=payload.value,
        context=payload.context,
        created_by=current_user.id,
    )
    db.add(ioc)
    await db.flush()  # assigns ioc.id before audit log

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=case_id,
        action="create",
        object_type="ioc",
        object_id=str(ioc.id),
        details={"ioc_type": payload.ioc_type, "value": payload.value},
        request=request,
    )

    await db.refresh(ioc)
    return ioc


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/iocs/{ioc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ioc(
    ioc_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> None:
    ioc = await _get_ioc_or_404(ioc_id, db)
    await require_case_write_access(ioc.case_id, current_user, db)

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=ioc.case_id,
        action="delete",
        object_type="ioc",
        object_id=str(ioc.id),
        details={"ioc_type": ioc.ioc_type, "value": ioc.value},
        request=request,
    )

    await db.delete(ioc)
    await db.flush()


# ── Link IOC ↔ Event ─────────────────────────────────────────────────────────

@router.post("/iocs/{ioc_id}/link/{event_id}", response_model=MessageResponse)
async def link_ioc_to_event(
    ioc_id: uuid.UUID,
    event_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> MessageResponse:
    ioc = await _get_ioc_or_404(ioc_id, db)
    await require_case_write_access(ioc.case_id, current_user, db)

    event_res = await db.execute(
        select(Event).where(Event.id == event_id, Event.is_deleted == False)
    )
    if event_res.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    # Prevent duplicate
    dup_res = await db.execute(
        select(EventIOC).where(
            EventIOC.ioc_id == ioc_id,
            EventIOC.event_id == event_id,
        )
    )
    if dup_res.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="IOC is already linked to this event",
        )

    link = EventIOC(event_id=event_id, ioc_id=ioc_id)
    db.add(link)

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=ioc.case_id,
        action="link_ioc",
        object_type="event_ioc",
        object_id=str(ioc_id),
        details={"event_id": str(event_id)},
        request=request,
    )

    await db.flush()
    return MessageResponse(message="IOC linked to event successfully")


@router.delete(
    "/iocs/{ioc_id}/link/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unlink_ioc_from_event(
    ioc_id: uuid.UUID,
    event_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> None:
    ioc = await _get_ioc_or_404(ioc_id, db)
    await require_case_write_access(ioc.case_id, current_user, db)

    link_res = await db.execute(
        select(EventIOC).where(
            EventIOC.ioc_id == ioc_id,
            EventIOC.event_id == event_id,
        )
    )
    link = link_res.scalar_one_or_none()
    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Link between IOC and event not found",
        )

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=ioc.case_id,
        action="unlink_ioc",
        object_type="event_ioc",
        object_id=str(ioc_id),
        details={"event_id": str(event_id)},
        request=request,
    )

    await db.delete(link)
    await db.flush()
