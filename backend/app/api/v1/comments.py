import uuid
from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_action
from app.core.auth import get_current_active_user
from app.core.rbac import require_case_access, require_case_write_access
from app.database import get_db
from app.models import Branch, Comment, CommentHistory, Event, User, UserRole
from app.schemas import CommentCreate, CommentResponse, CommentUpdate
from app.ws.manager import manager, MSG_COMMENT_ADDED

router = APIRouter(tags=["comments"])


def _comment_options():
    return (
        selectinload(Comment.author),
        selectinload(Comment.replies).selectinload(Comment.author),
    )


async def _get_event_or_404(event_id: uuid.UUID, db: AsyncSession) -> Event:
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.is_deleted == False)
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


async def _get_branch_or_404(branch_id: uuid.UUID, db: AsyncSession) -> Branch:
    result = await db.execute(select(Branch).where(Branch.id == branch_id))
    branch = result.scalar_one_or_none()
    if branch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")
    return branch


async def _get_comment_or_404(comment_id: uuid.UUID, db: AsyncSession) -> Comment:
    result = await db.execute(
        select(Comment)
        .options(*_comment_options())
        .where(Comment.id == comment_id, Comment.is_deleted == False)
    )
    comment = result.scalar_one_or_none()
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    return comment


def _build_comment_response(comment: Comment) -> CommentResponse:
    resp = CommentResponse.model_validate(comment)
    # Only one level of replies
    resp.replies = [
        CommentResponse.model_validate(r)
        for r in (comment.replies or [])
        if not r.is_deleted
    ]
    return resp


# ── Event comments ────────────────────────────────────────────────────────────

@router.get("/events/{event_id}/comments", response_model=List[CommentResponse])
async def list_event_comments(
    event_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> List[CommentResponse]:
    event = await _get_event_or_404(event_id, db)
    branch_res = await db.execute(select(Branch).where(Branch.id == event.branch_id))
    branch = branch_res.scalar_one()
    await require_case_access(branch.case_id, current_user, db)

    result = await db.execute(
        select(Comment)
        .options(*_comment_options())
        .where(
            Comment.event_id == event_id,
            Comment.parent_comment_id == None,  # noqa: E711
            Comment.is_deleted == False,
        )
        .order_by(Comment.created_at.asc())
    )
    comments = list(result.scalars().all())
    return [_build_comment_response(c) for c in comments]


@router.post(
    "/events/{event_id}/comments",
    response_model=CommentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_event_comment(
    event_id: uuid.UUID,
    payload: CommentCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> CommentResponse:
    event = await _get_event_or_404(event_id, db)
    branch_res = await db.execute(select(Branch).where(Branch.id == event.branch_id))
    branch = branch_res.scalar_one()
    await require_case_write_access(branch.case_id, current_user, db)

    # Validate parent comment
    if payload.parent_comment_id is not None:
        parent_res = await db.execute(
            select(Comment).where(
                Comment.id == payload.parent_comment_id,
                Comment.event_id == event_id,
                Comment.is_deleted == False,
            )
        )
        if parent_res.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parent comment not found",
            )

    comment = Comment(
        event_id=event_id,
        author_id=current_user.id,
        parent_comment_id=payload.parent_comment_id,
        body=payload.body,
        visibility=payload.visibility,
    )
    db.add(comment)

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=branch.case_id,
        action="create",
        object_type="comment",
        object_id=None,
        details={"event_id": str(event_id)},
        request=request,
    )

    await db.flush()

    loaded_res = await db.execute(
        select(Comment)
        .options(*_comment_options())
        .where(Comment.id == comment.id)
    )
    loaded = loaded_res.scalar_one()

    try:
        await manager.broadcast_to_case(
            str(branch.case_id),
            {
                "type": MSG_COMMENT_ADDED,
                "case_id": str(branch.case_id),
                "event_id": str(event_id),
                "comment_id": str(comment.id),
                "user_id": str(current_user.id),
            },
        )
    except Exception:  # noqa: BLE001
        pass

    return _build_comment_response(loaded)


# ── Branch comments ───────────────────────────────────────────────────────────

@router.get("/branches/{branch_id}/comments", response_model=List[CommentResponse])
async def list_branch_comments(
    branch_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> List[CommentResponse]:
    branch = await _get_branch_or_404(branch_id, db)
    await require_case_access(branch.case_id, current_user, db)

    result = await db.execute(
        select(Comment)
        .options(*_comment_options())
        .where(
            Comment.branch_id == branch_id,
            Comment.parent_comment_id == None,  # noqa: E711
            Comment.is_deleted == False,
        )
        .order_by(Comment.created_at.asc())
    )
    comments = list(result.scalars().all())
    return [_build_comment_response(c) for c in comments]


@router.post(
    "/branches/{branch_id}/comments",
    response_model=CommentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_branch_comment(
    branch_id: uuid.UUID,
    payload: CommentCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> CommentResponse:
    branch = await _get_branch_or_404(branch_id, db)
    await require_case_write_access(branch.case_id, current_user, db)

    comment = Comment(
        branch_id=branch_id,
        author_id=current_user.id,
        parent_comment_id=payload.parent_comment_id,
        body=payload.body,
        visibility=payload.visibility,
    )
    db.add(comment)

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=branch.case_id,
        action="create",
        object_type="comment",
        object_id=None,
        details={"branch_id": str(branch_id)},
        request=request,
    )

    await db.flush()

    loaded_res = await db.execute(
        select(Comment)
        .options(*_comment_options())
        .where(Comment.id == comment.id)
    )
    loaded = loaded_res.scalar_one()

    try:
        await manager.broadcast_to_case(
            str(branch.case_id),
            {
                "type": MSG_COMMENT_ADDED,
                "case_id": str(branch.case_id),
                "branch_id": str(branch_id),
                "comment_id": str(comment.id),
                "user_id": str(current_user.id),
            },
        )
    except Exception:  # noqa: BLE001
        pass

    return _build_comment_response(loaded)


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/comments/{comment_id}", response_model=CommentResponse)
async def update_comment(
    comment_id: uuid.UUID,
    payload: CommentUpdate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> CommentResponse:
    comment = await _get_comment_or_404(comment_id, db)

    # Only the author or admin can edit; treat NULL author_id as admin-only
    if (comment.author_id is None or comment.author_id != current_user.id) and current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot edit this comment")

    # Save history
    history = CommentHistory(
        comment_id=comment.id,
        body=comment.body,
        edited_by=current_user.id,
    )
    db.add(history)

    comment.body = payload.body

    await db.flush()

    loaded_res = await db.execute(
        select(Comment)
        .options(*_comment_options())
        .where(Comment.id == comment.id)
    )
    loaded = loaded_res.scalar_one()
    return _build_comment_response(loaded)


# ── Soft delete ───────────────────────────────────────────────────────────────

@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    comment_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> None:
    comment = await _get_comment_or_404(comment_id, db)

    if (comment.author_id is None or comment.author_id != current_user.id) and current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete this comment")

    comment.is_deleted = True
    await db.flush()


# ── Resolve ───────────────────────────────────────────────────────────────────

@router.patch("/comments/{comment_id}/resolve", response_model=CommentResponse)
async def resolve_comment(
    comment_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> CommentResponse:
    comment = await _get_comment_or_404(comment_id, db)

    # Resolve case_id for authorization
    if comment.event_id is not None:
        event_res = await db.execute(select(Event).where(Event.id == comment.event_id))
        event = event_res.scalar_one()
        branch_res = await db.execute(select(Branch).where(Branch.id == event.branch_id))
        case_id = branch_res.scalar_one().case_id
    else:
        branch_res = await db.execute(select(Branch).where(Branch.id == comment.branch_id))
        case_id = branch_res.scalar_one().case_id

    await require_case_write_access(case_id, current_user, db)

    comment.is_resolved = not comment.is_resolved

    await db.flush()

    loaded_res = await db.execute(
        select(Comment)
        .options(*_comment_options())
        .where(Comment.id == comment.id)
    )
    loaded = loaded_res.scalar_one()
    return _build_comment_response(loaded)
