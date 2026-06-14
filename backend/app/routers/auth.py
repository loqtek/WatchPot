from typing import Annotated
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit_service import write_audit
from app.auth_login import lookup_user_for_login
from app.database import get_db
from app.deps import get_current_user
from app.local_agent import ensure_auto_local_agent
from app.models.user import User
from app.runtime_config import is_public_registration_allowed
from app.schemas.auth import PasswordChange, ProfileUpdate, Token, UserCreate, UserLogin, UserOut
from app.time_utils import validate_timezone
from app.security import create_access_token, hash_secret, verify_secret

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger("watchpot.auth")


@router.get("/me", response_model=UserOut)
async def me(user: Annotated[User, Depends(get_current_user)]) -> User:
    """Current operator profile (JWT)."""
    return user


@router.patch("/me", response_model=UserOut)
async def update_me(
    request: Request,
    body: ProfileUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    if body.timezone is not None:
        try:
            user.timezone = validate_timezone(body.timezone)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        await write_audit(
            db,
            action="user.timezone_update",
            actor_user_id=user.id,
            resource_type="user",
            resource_id=str(user.id),
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    return user


@router.post("/register", response_model=UserOut)
async def register(
    request: Request,
    body: UserCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    if not is_public_registration_allowed():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public registration is disabled. Sign in as admin or enable allow_public_registration in app_settings.",
        )
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
        action="user.register",
        actor_user_id=user.id,
        resource_type="user",
        resource_id=str(user.id),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return user


@router.post("/password", response_model=dict[str, str])
async def change_password(
    request: Request,
    body: PasswordChange,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str]:
    if not verify_secret(body.current_password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    user.hashed_password = hash_secret(body.new_password)
    await write_audit(
        db,
        action="user.password_change",
        actor_user_id=user.id,
        resource_type="user",
        resource_id=str(user.id),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return {"status": "ok"}


@router.post("/login", response_model=Token)
async def login(
    request: Request,
    body: UserLogin,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Token:
    user = await lookup_user_for_login(db, body.identifier)
    if user is None or not verify_secret(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
    await write_audit(
        db,
        action="user.login",
        actor_user_id=user.id,
        resource_type="user",
        resource_id=str(user.id),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    local_agent_info: dict[str, object] | None = None
    try:
        local_agent = await ensure_auto_local_agent(
            db,
            actor_user_id=user.id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        if local_agent is not None:
            local_agent_info = {
                "pot_id": local_agent.pot_id,
                "created": local_agent.created,
                "credentials_written": local_agent.credentials_written,
            }
    except Exception:
        log.exception("Auto local agent setup failed")
    token = create_access_token(str(user.id))
    return Token(access_token=token, local_agent=local_agent_info)
