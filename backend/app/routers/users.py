from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit_service import write_audit
from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas.users import AdminPasswordReset, AdminUserCreate, UserAdminOut, UserUpdate
from app.security import hash_secret

router = APIRouter(prefix="/users", tags=["users"])


async def _count_active_users(db: AsyncSession) -> int:
    result = await db.execute(select(func.count()).select_from(User).where(User.is_active.is_(True)))
    return int(result.scalar_one())


async def _get_user_or_404(db: AsyncSession, user_id: UUID) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.get("", response_model=list[UserAdminOut])
async def list_users(
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[User]:
    result = await db.execute(select(User).order_by(User.created_at.asc()))
    return list(result.scalars().all())


@router.post("", response_model=UserAdminOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    request: Request,
    body: AdminUserCreate,
    actor: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    if body.username:
        taken = await db.execute(select(User).where(func.lower(User.username) == body.username.lower()))
        if taken.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
    user = User(
        email=body.email,
        username=body.username,
        hashed_password=hash_secret(body.password),
    )
    db.add(user)
    await db.flush()
    await write_audit(
        db,
        action="user.create",
        actor_user_id=actor.id,
        resource_type="user",
        resource_id=str(user.id),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return user


@router.patch("/{user_id}", response_model=UserAdminOut)
async def update_user(
    request: Request,
    user_id: UUID,
    body: UserUpdate,
    actor: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    user = await _get_user_or_404(db, user_id)
    if body.is_active is False and user.id == actor.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot deactivate your own account")
    if body.is_active is False and user.is_active:
        active_count = await _count_active_users(db)
        if active_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot deactivate the only active user",
            )
    if body.email is not None and body.email != user.email:
        taken = await db.execute(select(User).where(User.email == body.email, User.id != user.id))
        if taken.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")
        user.email = body.email
    if body.username is not None and body.username != user.username:
        if body.username:
            taken = await db.execute(
                select(User).where(func.lower(User.username) == body.username.lower(), User.id != user.id),
            )
            if taken.scalar_one_or_none():
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
        user.username = body.username
    if body.is_active is not None:
        user.is_active = body.is_active
    await write_audit(
        db,
        action="user.update",
        actor_user_id=actor.id,
        resource_type="user",
        resource_id=str(user.id),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return user


@router.post("/{user_id}/password", response_model=dict[str, str])
async def reset_user_password(
    request: Request,
    user_id: UUID,
    body: AdminPasswordReset,
    actor: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str]:
    user = await _get_user_or_404(db, user_id)
    user.hashed_password = hash_secret(body.new_password)
    await write_audit(
        db,
        action="user.password_reset",
        actor_user_id=actor.id,
        resource_type="user",
        resource_id=str(user.id),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return {"status": "ok"}
