import uuid
from typing import Optional, Any, Dict

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog


async def log_action(
    db: AsyncSession,
    user_id: Optional[uuid.UUID],
    case_id: Optional[uuid.UUID],
    action: str,
    object_type: str,
    object_id: Optional[str],
    details: Optional[Dict[str, Any]] = None,
    request: Optional[Request] = None,
) -> AuditLog:
    """
    Write an entry to the audit_log table.

    :param db:          Active async DB session (will NOT commit — caller controls txn).
    :param user_id:     UUID of the acting user (may be None for system actions).
    :param case_id:     UUID of the related case (may be None for non-case actions).
    :param action:      Verb describing what happened, e.g. "create", "update", "delete".
    :param object_type: Type of the affected object, e.g. "event", "branch", "case".
    :param object_id:   String representation of the object's primary key.
    :param details:     Optional dict with additional context / diff data.
    :param request:     Optional FastAPI Request — used to extract IP and User-Agent.
    :return:            The newly-created AuditLog instance (not yet committed).
    """
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None

    if request is not None:
        # Respect X-Forwarded-For for deployments behind a reverse proxy
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            ip_address = forwarded_for.split(",")[0].strip()
        else:
            ip_address = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")

    entry = AuditLog(
        case_id=case_id,
        user_id=user_id,
        action=action,
        object_type=object_type,
        object_id=object_id,
        details=details,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(entry)
    # Flush so the entry gets an id without committing the transaction
    await db.flush()
    return entry
