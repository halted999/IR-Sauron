import asyncio
import io
import json
import os
import subprocess
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Annotated
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_config
from app.core.audit import log_action
from app.core.crypto import decrypt_bytes, encrypt_bytes
from app.core.maintenance import set_last_restore_error, set_maintenance, set_restore_progress
from app.core.rbac import (
    DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS, PERMISSION_LABELS, require_admin, require_manage_backups,
    require_manage_settings,
)
from app.database import AsyncSessionLocal, engine, get_db
from app.models import AppSettings, RolePermission, User, UserRole
from app.schemas import (
    AppSettingsResponse, AppSettingsUpdate, BackupRequest, RolePermissionItem, RolePermissionsResponse,
    UpdateRolePermissionsRequest,
)

_RESTORE_CONFIRM_PHRASE = "ВОССТАНОВИТЬ"

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
    _: Annotated[User, Depends(require_manage_settings)],
) -> AppSettings:
    return await _get_or_create_settings(db)


@router.put("/settings", response_model=AppSettingsResponse)
async def update_settings(
    payload: AppSettingsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_manage_settings)],
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
    _: Annotated[User, Depends(require_manage_backups)],
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
    _: Annotated[User, Depends(require_manage_backups)],
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
    # Blocking call — run off the event loop so it doesn't freeze every other
    # in-flight request for the whole dump duration (single-threaded asyncio).
    proc = await asyncio.to_thread(subprocess.run, cmd, env=env, capture_output=True)
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


def _check_restore_confirm(confirm: str) -> None:
    if confirm.strip() != _RESTORE_CONFIRM_PHRASE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Введите фразу подтверждения «{_RESTORE_CONFIRM_PHRASE}»",
        )


def _decrypt_backup(password: str, raw: bytes) -> bytes:
    try:
        return decrypt_bytes(password, raw)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный пароль или повреждённый файл бэкапа",
        ) from exc


@router.post("/restore/config", response_model=AppSettingsResponse)
async def restore_config(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_manage_backups)],
    request: Request,
    file: UploadFile = File(...),
    password: str = Form(...),
    confirm: str = Form(...),
) -> AppSettings:
    _check_restore_confirm(confirm)
    plaintext = _decrypt_backup(password, await file.read())

    try:
        body = json.loads(plaintext)
        settings_data = dict(body["settings"])
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Некорректный формат файла бэкапа конфигурации",
        ) from exc

    allowed_fields = set(AppSettingsUpdate.model_fields)
    update = AppSettingsUpdate(**{k: v for k, v in settings_data.items() if k in allowed_fields})

    row = await _get_or_create_settings(db)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(row, field, value)

    await log_action(
        db=db, user_id=current_user.id, case_id=None,
        action="restore", object_type="config", object_id="settings",
        details={}, request=request,
    )

    await db.flush()
    await db.refresh(row)
    return row


async def _run_database_restore(dump: bytes, user_id: uuid.UUID) -> None:
    """
    Runs off the request/response cycle entirely (FastAPI BackgroundTasks) —
    a restore can take well past any reasonable HTTP timeout, so the request
    handler validates the upload and returns immediately; the frontend then
    polls /v1/ping (maintenance-mode-exempt) for progress and completion.
    """
    parsed = urlparse(app_config.database_url.replace("postgresql+asyncpg", "postgresql"))
    env = os.environ.copy()
    if parsed.password:
        env["PGPASSWORD"] = unquote(parsed.password)

    cmd = [
        "pg_restore",
        "-h", parsed.hostname or "localhost",
        "-p", str(parsed.port or 5432),
        "-U", parsed.username or "postgres",
        "-d", (parsed.path or "/").lstrip("/"),
        "--clean", "--if-exists", "--no-owner", "--no-privileges", "--verbose",
    ]

    try:
        # -l lists the archive's table-of-contents without restoring
        # anything — used only to get a total item count for the progress bar.
        list_proc = await asyncio.create_subprocess_exec(
            "pg_restore", "-l",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        list_stdout, _ = await list_proc.communicate(input=dump)
        total_items = sum(
            1 for line in list_stdout.decode(errors="replace").splitlines()
            if line.strip() and not line.startswith(";")
        )
        await set_restore_progress(0, total_items)

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        assert proc.stdin is not None and proc.stderr is not None
        proc.stdin.write(dump)
        await proc.stdin.drain()
        proc.stdin.close()

        stderr_chunks = []
        processed = 0
        async for raw_line in proc.stderr:
            stderr_chunks.append(raw_line)
            processed += 1
            if total_items and (processed % 5 == 0 or processed >= total_items):
                await set_restore_progress(min(processed, total_items), total_items)

        try:
            returncode = await asyncio.wait_for(proc.wait(), timeout=300)
        except asyncio.TimeoutError:
            proc.kill()
            await set_last_restore_error(
                "pg_restore не завершился за 5 минут — вероятно, заблокирован другим "
                "подключением к базе. Перезапустите сервис backend и попробуйте снова."
            )
            return

        await set_restore_progress(total_items, total_items)
        stderr_text = b"".join(stderr_chunks).decode(errors="replace")
        # pg_restore with --clean --if-exists commonly exits 1 on harmless
        # warnings (skipped DROPs, FK/ordering notices) even on an otherwise
        # successful restore — only treat it as fatal if it reports a real error.
        if returncode != 0 and "error" in stderr_text.lower():
            await set_last_restore_error(f"pg_restore завершился с ошибками: {stderr_text[:2000]}")
            return

        async with AsyncSessionLocal() as session:
            await log_action(
                db=session, user_id=user_id, case_id=None,
                action="restore", object_type="database", object_id="database",
                details={}, request=None,
            )
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        await set_last_restore_error(f"Восстановление завершилось с ошибкой: {exc}")
    finally:
        # pg_restore --clean drops and recreates every table under new OIDs —
        # any connection already in this worker's pool may hold a prepared
        # statement plan against the old ones, which asyncpg rejects with
        # InvalidCachedStatementError on next use. Disposing forces fresh
        # connections instead of waiting for each pooled one to fail once and
        # self-heal. (Other worker processes have their own separate pools
        # and heal independently, connection by connection, as they're used.)
        await engine.dispose()
        await set_maintenance(False)


@router.post("/restore/database", status_code=status.HTTP_202_ACCEPTED)
async def restore_database(
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(require_manage_backups)],
    file: UploadFile = File(...),
    password: str = Form(...),
    confirm: str = Form(...),
) -> dict:
    _check_restore_confirm(confirm)
    dump = _decrypt_backup(password, await file.read())

    # All other requests see a maintenance placeholder for the duration —
    # pg_restore --clean drops and recreates every table, so any request
    # touching the DB concurrently would otherwise see broken/missing data.
    await set_last_restore_error(None)
    await set_maintenance(True, reason="database restore in progress")
    background_tasks.add_task(_run_database_restore, dump, current_user.id)
    return {"status": "started", "detail": "Восстановление запущено в фоновом режиме"}


# ─── Role permission matrix ───────────────────────────────────────────────────
# Deliberately gated by require_admin (not require_permission) — this screen
# controls every other role's access, so it must never itself become
# delegable, or an admin could edit their way into locking every admin out.

_EDITABLE_ROLES = (UserRole.ir_lead, UserRole.investigator, UserRole.observer, UserRole.external_contractor)


async def _load_role_permissions(db: AsyncSession) -> RolePermissionsResponse:
    result = await db.execute(select(RolePermission))
    stored = {(rp.role, rp.permission): rp.allowed for rp in result.scalars().all()}
    items = [
        RolePermissionItem(
            role=role,
            permission=perm,
            allowed=stored.get((role, perm), DEFAULT_ROLE_PERMISSIONS.get((role, perm), False)),
        )
        for role in _EDITABLE_ROLES
        for perm in PERMISSION_KEYS
    ]
    return RolePermissionsResponse(permissions=items, labels=PERMISSION_LABELS)


@router.get("/role-permissions", response_model=RolePermissionsResponse)
async def get_role_permissions(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin)],
) -> RolePermissionsResponse:
    return await _load_role_permissions(db)


@router.put("/role-permissions", response_model=RolePermissionsResponse)
async def update_role_permissions(
    payload: UpdateRolePermissionsRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
) -> RolePermissionsResponse:
    changed = []
    for item in payload.permissions:
        if item.role not in _EDITABLE_ROLES or item.permission not in PERMISSION_KEYS:
            continue
        result = await db.execute(
            select(RolePermission).where(
                RolePermission.role == item.role, RolePermission.permission == item.permission,
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            db.add(RolePermission(role=item.role, permission=item.permission, allowed=item.allowed))
        elif row.allowed != item.allowed:
            row.allowed = item.allowed
        else:
            continue
        changed.append({"role": item.role.value, "permission": item.permission, "allowed": item.allowed})

    if changed:
        await log_action(
            db=db, user_id=current_user.id, case_id=None,
            action="update", object_type="role_permissions", object_id="matrix",
            details={"changed": changed}, request=request,
        )

    await db.flush()
    return await _load_role_permissions(db)
