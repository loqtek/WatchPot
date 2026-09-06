from typing import Annotated
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit_service import write_audit
from app.auth_login import lookup_user_for_login
from app.database import get_db
from app.deps import get_current_user
from app.local_agent import ensure_auto_local_agent
from app.models.user import User
from app.rate_limit import client_ip, enforce_auth_rate_limit
from app.runtime_config import is_public_registration_allowed
from app.schemas.auth import CsrfOut, PasswordChange, ProfileUpdate, Token, UserCreate, UserLogin, UserOut
from app.session_cookies import (
    CSRF_COOKIE,
    clear_auth_cookies,
    new_csrf_token,
    set_auth_cookies,
)
from app.time_utils import validate_timezone
from app.security import create_access_token, hash_secret, verify_secret

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger("watchpot.auth")


def _audit_ip(request: Request) -> str | None:
    return client_ip(request)


def _session_json(request: Request, jwt: str, local_agent: dict[str, object] | None = None) -> JSONResponse:
    csrf = new_csrf_token()
    body = Token(csrf_token=csrf, local_agent=local_agent)
    response = JSONResponse(content=body.model_dump())
    set_auth_cookies(response, request, jwt=jwt, csrf=csrf)
    return response


@router.get("/csrf", response_model=CsrfOut)
async def csrf_token(request: Request, response: Response) -> CsrfOut:
    """Issue or echo the double-submit CSRF token (readable cookie + JSON)."""
    existing = (request.cookies.get(CSRF_COOKIE) or "").strip()
    token = existing or new_csrf_token()
    jwt = (request.cookies.get("wp_session") or "").strip()
    if jwt:
        set_auth_cookies(response, request, jwt=jwt, csrf=token)
    else:
        from app.session_cookies import cookie_secure

        response.set_cookie(
            CSRF_COOKIE,
            token,
            max_age=60 * 60,
            path="/",
            httponly=False,
            secure=cookie_secure(request),
            samesite="lax",
        )
    return CsrfOut(csrf_token=token)


@router.get("/me", response_model=UserOut)
async def me(user: Annotated[User, Depends(get_current_user)]) -> User:
    """Current operator profile (session cookie or Bearer JWT)."""
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
            ip_address=_audit_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    return user


@router.post("/register", response_model=UserOut)
async def register(
    request: Request,
    body: UserCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    enforce_auth_rate_limit(request, "register")
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
        is_admin=False,
    )
    db.add(user)
    await db.flush()
    await write_audit(
        db,
        action="user.register",
        actor_user_id=user.id,
        resource_type="user",
        resource_id=str(user.id),
        ip_address=_audit_ip(request),
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
        ip_address=_audit_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    return {"status": "ok"}


@router.post("/login", response_model=Token)
async def login(
    request: Request,
    body: UserLogin,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JSONResponse:
    enforce_auth_rate_limit(request, "login")
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
        ip_address=_audit_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    local_agent_info: dict[str, object] | None = None
    try:
        local_agent = await ensure_auto_local_agent(
            db,
            actor_user_id=user.id,
            ip_address=_audit_ip(request),
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
    jwt = create_access_token(str(user.id))
    return _session_json(request, jwt, local_agent_info)


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict[str, str]:
    clear_auth_cookies(response, request)
    return {"status": "ok"}
