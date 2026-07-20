import hashlib
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_active_user
from app.core.rbac import require_case_access, require_case_write_access
from app.database import get_db
from app.models import Artifact, Branch, Event, User
from app.schemas import ArtifactDownloadResponse, ArtifactResponse
from app.services.storage import storage_service

router = APIRouter(tags=["artifacts"])


async def _get_event_or_404(event_id: uuid.UUID, db: AsyncSession) -> Event:
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.is_deleted == False)
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


async def _get_artifact_or_404(artifact_id: uuid.UUID, db: AsyncSession) -> Artifact:
    result = await db.execute(
        select(Artifact).where(Artifact.id == artifact_id)
    )
    artifact = result.scalar_one_or_none()
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    return artifact


async def _get_case_id_for_event(event: Event, db: AsyncSession) -> uuid.UUID:
    branch_res = await db.execute(select(Branch).where(Branch.id == event.branch_id))
    branch = branch_res.scalar_one()
    return branch.case_id


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post(
    "/events/{event_id}/artifacts",
    response_model=ArtifactResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_artifact(
    event_id: uuid.UUID,
    file: Annotated[UploadFile, File(...)],
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> Artifact:
    event = await _get_event_or_404(event_id, db)
    case_id = await _get_case_id_for_event(event, db)
    await require_case_write_access(case_id, current_user, db)

    file_data = await file.read()
    if not file_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )

    content_type = file.content_type or "application/octet-stream"
    filename = file.filename or f"artifact_{uuid.uuid4()}"

    # Compute MD5 alongside SHA-256 (SHA-256 is computed inside storage_service)
    md5_hex = hashlib.md5(file_data).hexdigest()

    storage_path, sha256_hex, file_size = await storage_service.upload_file(
        file_data=file_data,
        filename=filename,
        content_type=content_type,
    )

    artifact = Artifact(
        event_id=event_id,
        file_name=filename,
        storage_path=storage_path,
        content_type=content_type,
        file_size=file_size,
        sha256=sha256_hex,
        md5=md5_hex,
        is_worm=False,
        integrity_ok=True,
        upload_source="manual_upload",
        uploaded_by=current_user.id,
    )
    db.add(artifact)

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=case_id,
        action="upload",
        object_type="artifact",
        object_id=None,
        details={
            "event_id": str(event_id),
            "filename": filename,
            "sha256": sha256_hex,
            "file_size": file_size,
        },
        request=request,
    )

    await db.flush()
    await db.refresh(artifact)
    return artifact


# ── Download (presigned URL) ──────────────────────────────────────────────────

@router.get("/artifacts/{artifact_id}/download", response_model=ArtifactDownloadResponse)
async def download_artifact(
    artifact_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> ArtifactDownloadResponse:
    artifact = await _get_artifact_or_404(artifact_id, db)
    event = await _get_event_or_404(artifact.event_id, db)
    case_id = await _get_case_id_for_event(event, db)
    await require_case_access(case_id, current_user, db)

    url = await storage_service.get_presigned_url(artifact.storage_path)
    return ArtifactDownloadResponse(download_url=url, expires_in=3600)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/artifacts/{artifact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_artifact(
    artifact_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> None:
    artifact = await _get_artifact_or_404(artifact_id, db)
    event = await _get_event_or_404(artifact.event_id, db)
    case_id = await _get_case_id_for_event(event, db)
    await require_case_write_access(case_id, current_user, db)

    # Remove from MinIO (best-effort)
    try:
        await storage_service.delete_file(artifact.storage_path)
    except Exception:  # noqa: BLE001
        pass

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=case_id,
        action="delete",
        object_type="artifact",
        object_id=str(artifact.id),
        details={"filename": artifact.file_name},
        request=request,
    )

    await db.delete(artifact)
    await db.flush()
