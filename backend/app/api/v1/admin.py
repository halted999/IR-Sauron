import io
import json
import os
import subprocess
from datetime import datetime, timezone as dt_timezone
from typing import Annotated
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_config
from app.core.crypto import encrypt_bytes
from app.core.rbac import require_admin
from app.database import get_db
from app.models import AppSettings, User
from app.schemas import AppSettingsResponse, AppSettingsUpdate, BackupRequest

router = APIRouter(prefix="/admin", tags=["admin"])


async def _get_or_create_settings(db: AsyncSession) -> AppSettings:
    result = await db.execute(select(AppSettings).where(AppSettings.id == 1))
    row = result.scalar_one_or_none()
    if row is None:
        row = AppSettings(id=1)
        db.add(row)
        await db.flush()
        await db.refresh(row)
    return row


@router.get("/settings", response_model=AppSettingsResponse)
async def get_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> AppSettings:
    return await _get_or_create_settings(db)


@router.put("/settings", response_model=AppSettingsResponse)
async def update_settings(
    payload: AppSettingsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> AppSettings:
    row = await _get_or_create_settings(db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.flush()
    await db.refresh(row)
    return row


@router.post("/backup/config")
async def backup_config(
    payload: BackupRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> StreamingResponse:
    row = await _get_or_create_settings(db)
    data = AppSettingsResponse.model_validate(row).model_dump(mode="json")
    body = {
        "type": "irsauron-config-backup",
        "created_at": datetime.now(dt_timezone.utc).isoformat(),
        "settings": data,
    }
    plaintext = json.dumps(body, ensure_ascii=False, indent=2).encode("utf-8")
    encrypted = encrypt_bytes(payload.password, plaintext)

    filename = f"irsauron-config-backup-{datetime.now(dt_timezone.utc):%Y%m%d-%H%M%S}.enc"
    return StreamingResponse(
        io.BytesIO(encrypted),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/backup/database")
async def backup_database(
    payload: BackupRequest,
    _: Annotated[User, Depends(require_admin)],
) -> StreamingResponse:
    parsed = urlparse(app_config.database_url.replace("postgresql+asyncpg", "postgresql"))

    env = os.environ.copy()
    if parsed.password:
        env["PGPASSWORD"] = unquote(parsed.password)

    cmd = [
        "pg_dump",
        "-h", parsed.hostname or "localhost",
        "-p", str(parsed.port or 5432),
        "-U", parsed.username or "postgres",
        "-d", (parsed.path or "/").lstrip("/"),
        "-Fc",
    ]
    proc = subprocess.run(cmd, env=env, capture_output=True)
    if proc.returncode != 0:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"pg_dump failed: {proc.stderr.decode(errors='replace')[:500]}",
        )

    encrypted = encrypt_bytes(payload.password, proc.stdout)
    filename = f"irsauron-db-backup-{datetime.now(dt_timezone.utc):%Y%m%d-%H%M%S}.dump.enc"
    return StreamingResponse(
        io.BytesIO(encrypted),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
