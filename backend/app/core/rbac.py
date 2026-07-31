import uuid
from typing import Annotated, Dict, List, Tuple

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_active_user
from app.database import get_db
from app.models import CaseParticipant, RolePermission, User, UserRole

# ─── Permission matrix ──────────────────────────────────────────────────────
#
# `admin` is never stored in role_permissions and always passes every check
# (see has_permission) — the matrix only governs the other four roles, so an
# admin can never accidentally lock every admin out of the system by editing
# it. Every key below maps 1:1 onto what used to be a hardcoded role list on
# a route; the defaults reproduce that exact previous behavior, so turning
# this feature on doesn't change anyone's access until an admin edits it.

PERMISSION_LABELS: Dict[str, str] = {
    "manage_users": "Управление пользователями (создание, деактивация, роли)",
    "manage_event_sources": "Управление источниками алертов",
    "manage_settings": "Настройки системы (оповещения, часовой пояс)",
    "manage_backups": "Бэкапы и импорт конфигурации / базы данных",
    "write_alerts": "Работа с алертами (создание, статус, эскалация, назначение)",
    "manage_alert_rules": "Управление правилами алертов",
    "purge_alerts": "Безвозвратное удаление алертов",
    "manage_cases": "Создание и управление инцидентами (статус, участники)",
    "view_all_cases": "Просмотр всех инцидентов, а не только своих",
    "write_case_content": "Редактирование содержимого инцидента (события, IOC, комментарии, файлы)",
}

PERMISSION_KEYS: List[str] = list(PERMISSION_LABELS.keys())

_ALL_TRUE = dict.fromkeys(PERMISSION_KEYS, True)
_ALL_FALSE = dict.fromkeys(PERMISSION_KEYS, False)

DEFAULT_ROLE_PERMISSIONS: Dict[Tuple[UserRole, str], bool] = {}
for _perm, _allowed in {
    **_ALL_FALSE,
    "write_alerts": True,
    "manage_alert_rules": True,
    "manage_cases": True,
    "view_all_cases": True,
    "write_case_content": True,
}.items():
    DEFAULT_ROLE_PERMISSIONS[(UserRole.ir_lead, _perm)] = _allowed

for _perm, _allowed in {
    **_ALL_FALSE,
    "write_alerts": True,
    "manage_alert_rules": True,
    "write_case_content": True,
}.items():
    DEFAULT_ROLE_PERMISSIONS[(UserRole.investigator, _perm)] = _allowed

for _perm in PERMISSION_KEYS:
    DEFAULT_ROLE_PERMISSIONS[(UserRole.observer, _perm)] = False

for _perm, _allowed in {
    **_ALL_FALSE,
    # Matches the previous (somewhat inconsistent) behavior: external
    # contractors were never write_access-listed, but require_case_write_access
    # only ever hardcoded observer as read-only, so a contractor added as a
    # case participant could write case content.
    "write_case_content": True,
}.items():
    DEFAULT_ROLE_PERMISSIONS[(UserRole.external_contractor, _perm)] = _allowed


async def has_permission(db: AsyncSession, role: UserRole, permission: str) -> bool:
    if role == UserRole.admin:
        return True
    result = await db.execute(
        select(RolePermission.allowed).where(
            RolePermission.role == role, RolePermission.permission == permission,
        )
    )
    row = result.scalar_one_or_none()
    return bool(row) if row is not None else False


def require_permission(permission: str):
    """FastAPI dependency factory: 403s unless the current user's role has
    `permission` allowed in the role_permissions matrix (admin always passes)."""

    async def _check(
        current_user: Annotated[User, Depends(get_current_active_user)],
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> User:
        if not await has_permission(db, current_user.role, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role.value}' lacks permission '{permission}'",
            )
        return current_user

    return _check


class RoleChecker:
    """Dependency that checks if the current user has one of the allowed roles.
    Reserved for the handful of checks that must never be reconfigurable
    (admin-only gates on the permission matrix itself)."""

    def __init__(self, allowed_roles: List[UserRole]) -> None:
        self.allowed_roles = allowed_roles

    async def __call__(
        self,
        current_user: Annotated[User, Depends(get_current_active_user)],
    ) -> User:
        if current_user.role not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role.value}' is not authorized for this action",
            )
        return current_user


# Hardcoded, not part of the editable matrix.
require_admin = RoleChecker([UserRole.admin])

# Editable via the permission matrix.
require_manage_users = require_permission("manage_users")
require_manage_event_sources = require_permission("manage_event_sources")
require_manage_settings = require_permission("manage_settings")
require_manage_backups = require_permission("manage_backups")
require_write_access = require_permission("write_alerts")
require_manage_alert_rules = require_permission("manage_alert_rules")
require_purge_alerts = require_permission("purge_alerts")
require_manage_cases = require_permission("manage_cases")


async def require_case_access(
    case_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> bool:
    """
    Checks if the user has access to the given case.
    Admins, and roles with the `view_all_cases` permission, always have access.
    Other roles must be listed as a case participant.
    Raises HTTP 403 if not authorized.
    """
    if user.role == UserRole.admin or await has_permission(db, user.role, "view_all_cases"):
        return True

    result = await db.execute(
        select(CaseParticipant).where(
            CaseParticipant.case_id == case_id,
            CaseParticipant.user_id == user.id,
        )
    )
    participant = result.scalar_one_or_none()
    if participant is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this case",
        )
    return True


async def require_case_write_access(
    case_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> bool:
    """Same as require_case_access but also requires the `write_case_content`
    permission (admin always passes)."""
    if user.role != UserRole.admin and not await has_permission(db, user.role, "write_case_content"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your role is read-only",
        )
    return await require_case_access(case_id, user, db)
