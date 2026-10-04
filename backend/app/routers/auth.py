from typing import Annotated
import logging
import uuid

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
from app.schemas.auth import (
    CsrfOut,
    CurrentPassword,
    PasswordChange,
    ProfileUpdate,
    Token,
    TotpCode,
    TotpConfirmOut,
    TotpDisable,
    TotpSetupOut,
    UserCreate,
    UserLogin,
    UserOut,
)
from app.session_cookies import (
    CSRF_COOKIE,
    clear_auth_cookies,
    new_csrf_token,
    clear_preauth_cookie,
    preauth_token_from_request,
    session_token_from_request,
    set_auth_cookies,
    set_preauth_cookie,
)
from app.time_utils import validate_timezone
from app.security import (
    access_token_matches_user,
    create_access_token,
    create_preauth_token,
    decode_access_token,
    hash_secret,
    verify_secret,
)
from app.totp import consume_recovery, new_recovery_codes, new_secret, provisioning_uri, qr_svg, verify_totp

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger("watchpot.auth")


def _audit_ip(request: Request) -> str | None:
    return client_ip(request)


def _session_json(
    request: Request,
    jwt: str,
    local_agent: dict[str, object] | None = None,
    *,
    must_change_password: bool = False,
) -> JSONResponse:
    csrf = new_csrf_token()
    body = Token(
        csrf_token=csrf,
        local_agent=local_agent,
        must_change_password=must_change_password,
    )
    response = JSONResponse(content=body.model_dump())
    clear_preauth_cookie(response, request)
    set_auth_cookies(response, request, jwt=jwt, csrf=csrf)
    return response


def _bump_session(user: User) -> int:
    user.session_version = int(user.session_version or 0) + 1
    return user.session_version


async def _user_for_token(db: AsyncSession, token: str | None, *, expected_typ: str) -> User | None:
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload or payload.get("typ") != expected_typ or "sub" not in payload:
        return None
    try:
        user_id = uuid.UUID(str(payload["sub"]))
    except (ValueError, TypeError):
        return None
    result = await db.execute(select(User).where(User.id == user_id, User.is_active.is_(True)))
    user = result.scalar_one_or_none()
    if user is None:
        return None
    try:
        sv = int(payload.get("sv"))
    except (TypeError, ValueError):
        return None
    if sv != int(user.session_version or 0):
        return None
    if expected_typ == "access" and not access_token_matches_user(payload, session_version=user.session_version or 0):
        return None
    return user


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


@router.post("/password", response_model=Token)
async def change_password(
    request: Request,
    body: PasswordChange,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JSONResponse:
    if not verify_secret(body.current_password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    user.hashed_password = hash_secret(body.new_password)
    user.must_change_password = False
    version = _bump_session(user)
    await write_audit(
        db,
        action="user.password_change",
        actor_user_id=user.id,
        resource_type="user",
        resource_id=str(user.id),
        ip_address=_audit_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    jwt = create_access_token(str(user.id), session_version=version)
    return _session_json(request, jwt, must_change_password=False)


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
    if user.totp_enabled:
        preauth = create_preauth_token(str(user.id), session_version=int(user.session_version or 1))
        response = JSONResponse(content=Token(totp_required=True).model_dump())
        clear_auth_cookies(response, request)
        set_preauth_cookie(response, request, preauth)
        return response
    jwt = create_access_token(str(user.id), session_version=int(user.session_version or 1))
    return _session_json(
        request,
        jwt,
        local_agent_info,
        must_change_password=bool(user.must_change_password),
    )


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str]:
    user = await _user_for_token(db, session_token_from_request(request), expected_typ="access")
    if user is not None:
        _bump_session(user)
        await write_audit(
            db,
            action="user.logout",
            actor_user_id=user.id,
            resource_type="user",
            resource_id=str(user.id),
            ip_address=_audit_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    clear_auth_cookies(response, request)
    return {"status": "ok"}


def _reject_if_password_pending(user: User) -> None:
    if user.must_change_password:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Password change required")


@router.post("/totp/verify", response_model=Token)
async def verify_totp_login(
    request: Request,
    body: TotpCode,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JSONResponse:
    enforce_auth_rate_limit(request, "totp")
    user = await _user_for_token(db, preauth_token_from_request(request), expected_typ="preauth")
    if user is None or not user.totp_enabled or not user.totp_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign-in challenge expired")
    recovery = consume_recovery(user.totp_recovery_hashes, body.code)
    if not verify_totp(user.totp_secret, body.code) and recovery is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication code")
    if recovery is not None:
        user.totp_recovery_hashes = recovery
    await write_audit(
        db,
        action="user.totp_login",
        actor_user_id=user.id,
        resource_type="user",
        resource_id=str(user.id),
        ip_address=_audit_ip(request),
        user_agent=request.headers.get("user-agent"),
        detail={"recovery_code": recovery is not None},
    )
    jwt = create_access_token(str(user.id), session_version=int(user.session_version or 1))
    return _session_json(request, jwt, must_change_password=bool(user.must_change_password))


@router.post("/totp/setup", response_model=TotpSetupOut)
async def setup_totp(
    request: Request,
    body: CurrentPassword,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TotpSetupOut:
    _reject_if_password_pending(user)
    if not verify_secret(body.current_password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    secret = new_secret()
    user.totp_pending_secret = secret
    account = user.username or user.email
    uri = provisioning_uri(secret, account)
    await write_audit(
        db,
        action="user.totp_setup",
        actor_user_id=user.id,
        resource_type="user",
        resource_id=str(user.id),
        ip_address=_audit_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    return TotpSetupOut(secret=secret, otpauth_uri=uri, qr_svg=qr_svg(uri))


@router.post("/totp/confirm", response_model=TotpConfirmOut)
async def confirm_totp(
    request: Request,
    body: TotpCode,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TotpConfirmOut:
    _reject_if_password_pending(user)
    if not user.totp_pending_secret or not verify_totp(user.totp_pending_secret, body.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid authentication code")
    plain, hashes = new_recovery_codes()
    user.totp_secret = user.totp_pending_secret
    user.totp_pending_secret = None
    user.totp_enabled = True
    user.totp_recovery_hashes = hashes
    await write_audit(
        db,
        action="user.totp_enable",
        actor_user_id=user.id,
        resource_type="user",
        resource_id=str(user.id),
        ip_address=_audit_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    return TotpConfirmOut(recovery_codes=plain)


@router.post("/totp/disable", response_model=Token)
async def disable_totp(
    request: Request,
    body: TotpDisable,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JSONResponse:
    _reject_if_password_pending(user)
    if not user.totp_enabled or not user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Authenticator is not enabled")
    if not verify_secret(body.current_password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    recovery = consume_recovery(user.totp_recovery_hashes, body.code)
    if not verify_totp(user.totp_secret, body.code) and recovery is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid authentication code")
    user.totp_enabled = False
    user.totp_secret = None
    user.totp_pending_secret = None
    user.totp_recovery_hashes = None
    version = _bump_session(user)
    await write_audit(
        db,
        action="user.totp_disable",
        actor_user_id=user.id,
        resource_type="user",
        resource_id=str(user.id),
        ip_address=_audit_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    jwt = create_access_token(str(user.id), session_version=version)
    return _session_json(request, jwt)
