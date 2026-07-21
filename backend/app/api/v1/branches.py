import uuid
from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_active_user
from app.core.rbac import require_case_access, require_case_write_access
from app.database import get_db
from app.models import Branch, BranchStatus, Case, Event, User
from app.schemas import BranchCreate, BranchResponse, BranchTreeResponse, BranchUpdate, MessageResponse
from app.ws.manager import manager, MSG_BRANCH_STATUS_CHANGED

router = APIRouter(tags=["branches"])


async def _get_branch_or_404(branch_id: uuid.UUID, db: AsyncSession) -> Branch:
    result = await db.execute(
        select(Branch).where(Branch.id == branch_id)
    )
    branch = result.scalar_one_or_none()
    if branch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")
    return branch


async def _get_case_or_404(case_id: uuid.UUID, db: AsyncSession) -> Case:
    result = await db.execute(
        select(Case).where(Case.id == case_id, Case.is_deleted == False)
    )
    case = result.scalar_one_or_none()
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")
    return case


def _build_tree(branches: List[Branch], parent_id=None) -> List[BranchTreeResponse]:
    nodes = []
    for b in branches:
        if b.parent_branch_id == parent_id:
            node = BranchTreeResponse.model_validate(b)
            node.children = _build_tree(branches, parent_id=b.id)
            nodes.append(node)
    return nodes


# ── List (tree) ───────────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/branches", response_model=List[BranchTreeResponse])
async def list_branches(
    case_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> List[BranchTreeResponse]:
    await _get_case_or_404(case_id, db)
    await require_case_access(case_id, current_user, db)

    result = await db.execute(
        select(Branch)
        .where(Branch.case_id == case_id)
        .order_by(Branch.created_at.asc())
    )
    branches = list(result.scalars().all())
    return _build_tree(branches)


# ── Create ────────────────────────────────────────────────────────────────────

@router.post(
    "/cases/{case_id}/branches",
    response_model=BranchResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_branch(
    case_id: uuid.UUID,
    payload: BranchCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> Branch:
    await _get_case_or_404(case_id, db)
    await require_case_write_access(case_id, current_user, db)

    # Validate parent branch belongs to same case
    if payload.parent_branch_id is not None:
        parent_res = await db.execute(
            select(Branch).where(
                Branch.id == payload.parent_branch_id,
                Branch.case_id == case_id,
            )
        )
        if parent_res.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parent branch not found in this case",
            )

    # Validate branch-point event
    if payload.branch_point_event_id is not None:
        evt_res = await db.execute(
            select(Event).where(
                Event.id == payload.branch_point_event_id,
                Event.is_deleted == False,
            )
        )
        if evt_res.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch point event not found",
            )

    branch = Branch(
        case_id=case_id,
        name=payload.name,
        description=payload.description,
        parent_branch_id=payload.parent_branch_id,
        branch_point_event_id=payload.branch_point_event_id,
        is_main=False,
        status=BranchStatus.hypothesis,
        created_by=current_user.id,
    )
    db.add(branch)
    await db.flush()  # assigns branch.id before audit log

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=case_id,
        action="create",
        object_type="branch",
        object_id=str(branch.id),
        details={"name": branch.name},
        request=request,
    )

    await db.refresh(branch)
    return branch


# ── Read ──────────────────────────────────────────────────────────────────────

@router.get("/branches/{branch_id}", response_model=BranchResponse)
async def get_branch(
    branch_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> Branch:
    branch = await _get_branch_or_404(branch_id, db)
    await require_case_access(branch.case_id, current_user, db)
    return branch


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/branches/{branch_id}", response_model=BranchResponse)
async def update_branch(
    branch_id: uuid.UUID,
    payload: BranchUpdate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> Branch:
    branch = await _get_branch_or_404(branch_id, db)
    await require_case_write_access(branch.case_id, current_user, db)

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(branch, field, value)

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=branch.case_id,
        action="update",
        object_type="branch",
        object_id=str(branch.id),
        details=update_data,
        request=request,
    )

    await db.flush()
    await db.refresh(branch)

    # Broadcast status change if status was updated
    if "status" in update_data:
        try:
            await manager.broadcast_to_case(
                str(branch.case_id),
                {
                    "type": MSG_BRANCH_STATUS_CHANGED,
                    "case_id": str(branch.case_id),
                    "branch_id": str(branch.id),
                    "status": branch.status.value,
                    "user_id": str(current_user.id),
                },
            )
        except Exception:  # noqa: BLE001
            pass

    return branch


# ── Merge ─────────────────────────────────────────────────────────────────────

@router.post("/branches/{branch_id}/merge", response_model=MessageResponse)
async def merge_branch(
    branch_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> MessageResponse:
    branch = await _get_branch_or_404(branch_id, db)
    await require_case_write_access(branch.case_id, current_user, db)

    if branch.is_main:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot merge the main branch",
        )
    if branch.status != BranchStatus.confirmed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only confirmed branches can be merged",
        )

    # Get the main branch for this case
    main_res = await db.execute(
        select(Branch).where(
            Branch.case_id == branch.case_id,
            Branch.is_main == True,
        )
    )
    main_branch = main_res.scalar_one_or_none()
    if main_branch is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Main branch not found",
        )

    # Move all non-deleted events from this branch to the main branch
    events_res = await db.execute(
        select(Event).where(
            Event.branch_id == branch.id,
            Event.is_deleted == False,
        )
    )
    events = list(events_res.scalars().all())
    for event in events:
        event.branch_id = main_branch.id

    # Mark the branch as handled (keep as confirmed, just note it was merged)
    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=branch.case_id,
        action="merge",
        object_type="branch",
        object_id=str(branch.id),
        details={
            "target_branch_id": str(main_branch.id),
            "events_moved": len(events),
        },
        request=request,
    )

    await db.flush()
    return MessageResponse(
        message=f"Merged {len(events)} events from branch '{branch.name}' into main timeline"
    )


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/branches/{branch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_branch(
    branch_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> None:
    branch = await _get_branch_or_404(branch_id, db)
    await require_case_write_access(branch.case_id, current_user, db)

    if branch.is_main:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete the main branch",
        )

    events_res = await db.execute(
        select(Event).where(Event.branch_id == branch_id, Event.is_deleted == False)
    )
    if events_res.scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a branch that still has events; move or delete its events first",
        )

    await log_action(
        db=db,
        user_id=current_user.id,
        case_id=branch.case_id,
        action="delete",
        object_type="branch",
        object_id=str(branch.id),
        details={"name": branch.name},
        request=request,
    )

    await db.delete(branch)
    await db.flush()
