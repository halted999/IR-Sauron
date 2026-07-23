import uuid
from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.rbac import require_admin
from app.database import get_db
from app.models import EventSource, EventSourceType, User
from app.schemas import (
    EventSourceCreate, EventSourceResponse, EventSourceSyncResult,
    EventSourceTestResult, EventSourceUpdate,
)
from app.services.elastic_client import ElasticClient
from app.services.event_source_scheduler import sync_source
from app.services.thehive_client import TheHiveClient

router = APIRouter(prefix="/event-sources", tags=["event-sources"])


def _serialize(source: EventSource) -> EventSourceResponse:
    return EventSourceResponse(
        id=source.id,
        name=source.name,
        source_type=source.source_type,
        base_url=source.base_url,
        verify_ssl=source.verify_ssl,
        auth_username=source.auth_username,
        has_secret=bool(source.auth_secret_encrypted),
        config=source.config,
        is_enabled=source.is_enabled,
        poll_interval_seconds=source.poll_interval_seconds,
        last_synced_at=source.last_synced_at,
        last_sync_status=source.last_sync_status,
        last_sync_message=source.last_sync_message,
        last_sync_alert_count=source.last_sync_alert_count,
        created_at=source.created_at,
        updated_at=source.updated_at,
    )


async def _get_source_or_404(source_id: uuid.UUID, db: AsyncSession) -> EventSource:
    result = await db.execute(select(EventSource).where(EventSource.id == source_id))
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event source not found")
    return source


def _build_client(source: EventSource, secret: str | None):
    if source.source_type == EventSourceType.elastic:
        return ElasticClient(source.base_url, source.auth_username, secret, source.verify_ssl)
    return TheHiveClient(source.base_url, secret, source.verify_ssl)


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[EventSourceResponse])
async def list_event_sources(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> List[EventSourceResponse]:
    result = await db.execute(select(EventSource).order_by(EventSource.name))
    return [_serialize(s) for s in result.scalars().all()]


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("", response_model=EventSourceResponse, status_code=status.HTTP_201_CREATED)
async def create_event_source(
    payload: EventSourceCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
) -> EventSourceResponse:
    source = EventSource(
        name=payload.name,
        source_type=payload.source_type,
        base_url=payload.base_url,
        verify_ssl=payload.verify_ssl,
        auth_username=payload.auth_username,
        auth_secret_encrypted=encrypt_secret(payload.auth_secret) if payload.auth_secret else None,
        config=payload.config,
        is_enabled=payload.is_enabled,
        poll_interval_seconds=payload.poll_interval_seconds,
        created_by=current_user.id,
    )
    db.add(source)
    await db.flush()

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=None,
        action="create",
        object_type="event_source",
        object_id=str(source.id),
        details={"name": source.name, "source_type": source.source_type.value},
        request=request,
    )

    await db.flush()
    await db.refresh(source)
    return _serialize(source)


# ── Read ──────────────────────────────────────────────────────────────────────

@router.get("/{source_id}", response_model=EventSourceResponse)
async def get_event_source(
    source_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> EventSourceResponse:
    return _serialize(await _get_source_or_404(source_id, db))


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/{source_id}", response_model=EventSourceResponse)
async def update_event_source(
    source_id: uuid.UUID,
    payload: EventSourceUpdate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
) -> EventSourceResponse:
    source = await _get_source_or_404(source_id, db)

    update_data = payload.model_dump(exclude_unset=True, exclude={"auth_secret"})
    for field, value in update_data.items():
        setattr(source, field, value)
    if payload.auth_secret:
        source.auth_secret_encrypted = encrypt_secret(payload.auth_secret)

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=None,
        action="update",
        object_type="event_source",
        object_id=str(source.id),
        details=update_data,
        request=request,
    )

    await db.flush()
    await db.refresh(source)
    return _serialize(source)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event_source(
    source_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
) -> None:
    source = await _get_source_or_404(source_id, db)

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=None,
        action="delete",
        object_type="event_source",
        object_id=str(source.id),
        details={"name": source.name},
        request=request,
    )

    await db.delete(source)
    await db.flush()


# ── Test connection ───────────────────────────────────────────────────────────

@router.post("/{source_id}/test-connection", response_model=EventSourceTestResult)
async def test_event_source_connection(
    source_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> EventSourceTestResult:
    source = await _get_source_or_404(source_id, db)
    secret = decrypt_secret(source.auth_secret_encrypted) if source.auth_secret_encrypted else None
    client = _build_client(source, secret)
    ok, message = await client.test_connection()
    return EventSourceTestResult(ok=ok, message=message)


# ── Sync now ──────────────────────────────────────────────────────────────────

@router.post("/{source_id}/sync-now", response_model=EventSourceSyncResult)
async def sync_event_source_now(
    source_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> EventSourceSyncResult:
    source = await _get_source_or_404(source_id, db)
    return await sync_source(db, source)
