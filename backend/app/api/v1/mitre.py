from typing import Annotated, List

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_active_user
from app.core.rbac import require_manage_settings
from app.database import get_db
from app.models import AppSettings, MitreTechnique, User
from app.schemas import (
    MitreMatrixResponse, MitreSettingsResponse, MitreSettingsUpdate, MitreSyncResult, MitreTacticInfo,
)
from app.services.mitre_attack import TACTIC_GRIF, TACTIC_LABELS, TACTIC_SEVERITY
from app.services.mitre_sync import STIX_URL, sync_mitre_matrix

router = APIRouter(prefix="/mitre", tags=["mitre"])


async def _get_or_create_settings(db: AsyncSession) -> AppSettings:
    result = await db.execute(select(AppSettings).where(AppSettings.id == 1))
    row = result.scalar_one_or_none()
    if row is None:
        row = AppSettings(id=1)
        db.add(row)
        await db.flush()
    return row


@router.get("/matrix", response_model=MitreMatrixResponse)
async def get_matrix(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_active_user)],
) -> MitreMatrixResponse:
    settings_row = await _get_or_create_settings(db)
    result = await db.execute(select(MitreTechnique).order_by(MitreTechnique.id))
    techniques = list(result.scalars().all())

    tactics = [
        MitreTacticInfo(
            shortname=shortname,
            label=label,
            severity=TACTIC_SEVERITY[shortname].value,
            grif=TACTIC_GRIF[shortname],
        )
        for shortname, label in TACTIC_LABELS.items()
    ]

    return MitreMatrixResponse(
        tactics=tactics,
        techniques=techniques,
        technique_count=len(techniques),
        last_synced_at=settings_row.mitre_last_synced_at,
    )


@router.get("/settings", response_model=MitreSettingsResponse)
async def get_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_manage_settings)],
) -> MitreSettingsResponse:
    row = await _get_or_create_settings(db)
    return MitreSettingsResponse(
        sync_interval_hours=row.mitre_sync_interval_hours,
        last_synced_at=row.mitre_last_synced_at,
        last_sync_status=row.mitre_last_sync_status,
        last_sync_message=row.mitre_last_sync_message,
        technique_count=row.mitre_technique_count,
        source_url=STIX_URL,
    )


@router.put("/settings", response_model=MitreSettingsResponse)
async def update_settings(
    payload: MitreSettingsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_manage_settings)],
) -> MitreSettingsResponse:
    row = await _get_or_create_settings(db)
    row.mitre_sync_interval_hours = payload.sync_interval_hours
    await db.flush()
    return MitreSettingsResponse(
        sync_interval_hours=row.mitre_sync_interval_hours,
        last_synced_at=row.mitre_last_synced_at,
        last_sync_status=row.mitre_last_sync_status,
        last_sync_message=row.mitre_last_sync_message,
        technique_count=row.mitre_technique_count,
        source_url=STIX_URL,
    )


@router.post("/sync-now", response_model=MitreSyncResult)
async def sync_now(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_manage_settings)],
) -> MitreSyncResult:
    ok, message, count = await sync_mitre_matrix(db)
    return MitreSyncResult(ok=ok, message=message, technique_count=count)
