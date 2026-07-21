import uuid
from typing import Annotated, List, Optional, Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_action
from app.core.auth import get_current_active_user
from app.core.rbac import require_case_access, require_case_write_access
from app.database import get_db
from app.models import (
    Branch, Event, EventIOC, EventLink, EventVersion, IOC, User, Artifact
)
from app.schemas import (
    EventCreate, EventDeleteRequest, EventLinkCreate, EventLinkResponse,
    EventResponse, EventUpdate, EventVersionResponse,
)
from app.ws.manager import manager, MSG_EVENT_CREATED, MSG_EVENT_UPDATED, MSG_EVENT_DELETED

router = APIRouter(tags=["events"])


def _event_options():
    return (
        selectinload(Event.artifacts),
        selectinload(Event.ioc_links).selectinload(EventIOC.ioc),
        selectinload(Event.outgoing_links),
        selectinload(Event.incoming_links),
    )


async def _get_branch_or_404(branch_id: uuid.UUID, db: AsyncSession) -> Branch:
    result = await db.execute(select(Branch).where(Branch.id == branch_id))
    branch = result.scalar_one_or_none()
    if branch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")
    return branch


async def _get_event_or_404(event_id: uuid.UUID, db: AsyncSession) -> Event:
    result = await db.execute(
        select(Event)
        .options(*_event_options())
        .where(Event.id == event_id, Event.is_deleted == False)
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


def _event_to_snapshot(event: Event) -> Dict[str, Any]:
    return {
        "event_ts": event.event_ts.isoformat() if event.event_ts else None,
        "event_ts_tz_offset": event.event_ts_tz_offset,
        "event_type": event.event_type.value,
        "title": event.title,
        "description": event.description,
        "source_description": event.source_description,
        "confidence_level": event.confidence_level.value,
        "mitre_tactic": event.mitre_tactic,
        "mitre_technique": event.mitre_technique,
        "mitre_subtechnique": event.mitre_subtechnique,
        "action_type": event.action_type.value if event.action_type else None,
        "sort_order": event.sort_order,
        "version": event.version,
    }


def _compute_diff(old: Dict[str, Any], new_data: Dict[str, Any]) -> Dict[str, Any]:
    changes: Dict[str, Any] = {}
    for key, new_val in new_data.items():
        old_val = old.get(key)
        if old_val != new_val:
            changes[key] = {"old": old_val, "new": new_val}
    return changes


def _build_event_response(event: Event) -> EventResponse:
    from app.schemas import ArtifactShort, IOCShort

    artifacts = [ArtifactShort.model_validate(a) for a in event.artifacts]
    iocs = [IOCShort.model_validate(link.ioc) for link in event.ioc_links]
    links = [
        EventLinkResponse.model_validate(lnk) for lnk in event.outgoing_links
    ] + [
        EventLinkResponse.model_validate(lnk) for lnk in event.incoming_links
    ]

    resp = EventResponse.model_validate(event)
    resp.artifacts = artifacts
    resp.iocs = iocs
    resp.linked_events = links
    return resp


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/branches/{branch_id}/events", response_model=List[EventResponse])
async def list_events(
    branch_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> List[EventResponse]:
    branch = await _get_branch_or_404(branch_id, db)
    await require_case_access(branch.case_id, current_user, db)

    result = await db.execute(
        select(Event)
        .options(*_event_options())
        .where(Event.branch_id == branch_id, Event.is_deleted == False)
        .order_by(Event.event_ts.asc().nulls_last(), Event.sort_order.asc())
    )
    events = list(result.scalars().all())
    return [_build_event_response(e) for e in events]


# ── Create ────────────────────────────────────────────────────────────────────

@router.post(
    "/branches/{branch_id}/events",
    response_model=EventResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_event(
    branch_id: uuid.UUID,
    payload: EventCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> EventResponse:
    branch = await _get_branch_or_404(branch_id, db)
    await require_case_write_access(branch.case_id, current_user, db)

    if payload.branch_id != branch_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="branch_id in body must match URL parameter",
        )

    event = Event(
        branch_id=branch_id,
        event_ts=payload.event_ts,
        event_ts_tz_offset=payload.event_ts_tz_offset,
        event_type=payload.event_type,
        title=payload.title,
        description=payload.description,
        source_description=payload.source_description,
        confidence_level=payload.confidence_level,
        mitre_tactic=payload.mitre_tactic,
        mitre_technique=payload.mitre_technique,
        mitre_subtechnique=payload.mitre_subtechnique,
        action_type=payload.action_type,
        sort_order=payload.sort_order,
        version=1,
        created_by=current_user.id,
    )
    db.add(event)
    await db.flush()

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=branch.case_id,
        action="create",
        object_type="event",
        object_id=str(event.id),
        details={"title": event.title, "event_type": event.event_type.value},
        request=request,
    )

    await db.flush()
    await db.refresh(event)

    # Reload with eager relationships
    loaded = await _get_event_or_404(event.id, db)
    resp = _build_event_response(loaded)

    # WebSocket broadcast
    try:
        await manager.broadcast_to_case(
            str(branch.case_id),
            {
                "type": MSG_EVENT_CREATED,
                "case_id": str(branch.case_id),
                "branch_id": str(branch_id),
                "event_id": str(event.id),
                "title": event.title,
                "user_id": str(current_user.id),
            },
        )
    except Exception:  # noqa: BLE001
        pass

    return resp


# ── Read ──────────────────────────────────────────────────────────────────────

@router.get("/events/{event_id}", response_model=EventResponse)
async def get_event(
    event_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> EventResponse:
    event = await _get_event_or_404(event_id, db)
    branch_res = await db.execute(select(Branch).where(Branch.id == event.branch_id))
    branch = branch_res.scalar_one()
    await require_case_access(branch.case_id, current_user, db)
    return _build_event_response(event)


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/events/{event_id}", response_model=EventResponse)
async def update_event(
    event_id: uuid.UUID,
    payload: EventUpdate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> EventResponse:
    event = await _get_event_or_404(event_id, db)
    branch_res = await db.execute(select(Branch).where(Branch.id == event.branch_id))
    branch = branch_res.scalar_one()
    await require_case_write_access(branch.case_id, current_user, db)

    # Capture snapshot before update
    old_snapshot = _event_to_snapshot(event)

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(event, field, value)

    # Compute diff between serialised snapshots so enum members compare as strings
    new_snapshot = _event_to_snapshot(event)
    diff = _compute_diff(old_snapshot, new_snapshot)

    # Save version record
    version_record = EventVersion(
        event_id=event.id,
        version=event.version,
        changed_by=current_user.id,
        changes=diff,
        snapshot=old_snapshot,
    )
    db.add(version_record)

    # Increment version
    event.version += 1

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=branch.case_id,
        action="update",
        object_type="event",
        object_id=str(event.id),
        details=diff,
        request=request,
    )

    await db.flush()

    loaded = await _get_event_or_404(event.id, db)
    resp = _build_event_response(loaded)

    try:
        await manager.broadcast_to_case(
            str(branch.case_id),
            {
                "type": MSG_EVENT_UPDATED,
                "case_id": str(branch.case_id),
                "branch_id": str(event.branch_id),
                "event_id": str(event.id),
                "version": event.version,
                "user_id": str(current_user.id),
            },
        )
    except Exception:  # noqa: BLE001
        pass

    return resp


# ── Soft Delete ───────────────────────────────────────────────────────────────

@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: uuid.UUID,
    payload: EventDeleteRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> None:
    event = await _get_event_or_404(event_id, db)
    branch_res = await db.execute(select(Branch).where(Branch.id == event.branch_id))
    branch = branch_res.scalar_one()
    await require_case_write_access(branch.case_id, current_user, db)

    event.is_deleted = True
    event.delete_reason = payload.delete_reason

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=branch.case_id,
        action="delete",
        object_type="event",
        object_id=str(event.id),
        details={"reason": payload.delete_reason},
        request=request,
    )

    await db.flush()

    try:
        await manager.broadcast_to_case(
            str(branch.case_id),
            {
                "type": MSG_EVENT_DELETED,
                "case_id": str(branch.case_id),
                "event_id": str(event.id),
                "user_id": str(current_user.id),
            },
        )
    except Exception:  # noqa: BLE001
        pass


# ── History ───────────────────────────────────────────────────────────────────

@router.get("/events/{event_id}/history", response_model=List[EventVersionResponse])
async def get_event_history(
    event_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> List[EventVersion]:
    # Even for deleted events — allow history access
    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    branch_res = await db.execute(select(Branch).where(Branch.id == event.branch_id))
    branch = branch_res.scalar_one()
    await require_case_access(branch.case_id, current_user, db)

    versions_res = await db.execute(
        select(EventVersion)
        .where(EventVersion.event_id == event_id)
        .order_by(EventVersion.version.asc())
    )
    return list(versions_res.scalars().all())


# ── Links ─────────────────────────────────────────────────────────────────────

@router.post(
    "/events/{event_id}/links",
    response_model=EventLinkResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_event_link(
    event_id: uuid.UUID,
    payload: EventLinkCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> EventLink:
    source_event = await _get_event_or_404(event_id, db)
    branch_res = await db.execute(select(Branch).where(Branch.id == source_event.branch_id))
    branch = branch_res.scalar_one()
    await require_case_write_access(branch.case_id, current_user, db)

    # Verify target event exists
    target_res = await db.execute(
        select(Event).where(Event.id == payload.target_event_id, Event.is_deleted == False)
    )
    if target_res.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target event not found")

    # Check for duplicate
    dup_res = await db.execute(
        select(EventLink).where(
            EventLink.source_event_id == event_id,
            EventLink.target_event_id == payload.target_event_id,
            EventLink.link_type == payload.link_type,
        )
    )
    if dup_res.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Link already exists",
        )

    link = EventLink(
        source_event_id=event_id,
        target_event_id=payload.target_event_id,
        link_type=payload.link_type,
        description=payload.description,
    )
    db.add(link)

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=branch.case_id,
        action="create_link",
        object_type="event_link",
        object_id=str(event_id),
        details={
            "target_event_id": str(payload.target_event_id),
            "link_type": payload.link_type,
        },
        request=request,
    )

    await db.flush()
    await db.refresh(link)
    return link


@router.get("/events/{event_id}/links", response_model=List[EventLinkResponse])
async def get_event_links(
    event_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> List[EventLink]:
    event = await _get_event_or_404(event_id, db)
    branch_res = await db.execute(select(Branch).where(Branch.id == event.branch_id))
    branch = branch_res.scalar_one()
    await require_case_access(branch.case_id, current_user, db)

    outgoing_res = await db.execute(
        select(EventLink).where(EventLink.source_event_id == event_id)
    )
    incoming_res = await db.execute(
        select(EventLink).where(EventLink.target_event_id == event_id)
    )
    return list(outgoing_res.scalars().all()) + list(incoming_res.scalars().all())


@router.delete("/events/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event_link(
    link_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> None:
    result = await db.execute(select(EventLink).where(EventLink.id == link_id))
    link = result.scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")

    source_event = await _get_event_or_404(link.source_event_id, db)
    branch_res = await db.execute(select(Branch).where(Branch.id == source_event.branch_id))
    branch = branch_res.scalar_one()
    await require_case_write_access(branch.case_id, current_user, db)

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=branch.case_id,
        action="delete_link",
        object_type="event_link",
        object_id=str(link_id),
        details={
            "source_event_id": str(link.source_event_id),
            "target_event_id": str(link.target_event_id),
            "link_type": link.link_type,
        },
        request=request,
    )

    await db.delete(link)
    await db.flush()
