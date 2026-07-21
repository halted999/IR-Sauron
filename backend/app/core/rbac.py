import uuid
from typing import Annotated, List

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_active_user
from app.models import User, UserRole, CaseParticipant


class RoleChecker:
    """Dependency that checks if the current user has one of the allowed roles."""

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


# Pre-built role checkers
require_admin = RoleChecker([UserRole.admin])
require_admin_or_lead = RoleChecker([UserRole.admin, UserRole.ir_lead])
require_write_access = RoleChecker([
    UserRole.admin,
    UserRole.ir_lead,
    UserRole.investigator,
    UserRole.threat_hunter,
])


async def require_case_access(
    case_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> bool:
    """
    Checks if the user has access to the given case.
    Admins and IR leads always have access.
    Other roles must be listed as a case participant.
    Raises HTTP 403 if not authorized.
    """
    if user.role in (UserRole.admin, UserRole.ir_lead):
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
    """
    Same as require_case_access but also enforces that the user's role allows writes.
    Observers and legal roles are read-only.
    """
    read_only_roles = {UserRole.observer, UserRole.legal}
    if user.role in read_only_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your role is read-only",
        )
    return await require_case_access(case_id, user, db)
