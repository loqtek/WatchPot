from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit_service import write_audit
from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.runtime_config import (
    get_access_token_expire_minutes,
    get_cors_origins,
    get_deployment_stack_mode,
    get_external_log_paths,
    get_heartbeat_stale_minutes,
    get_jwt_algorithm,
    is_public_registration_allowed,
    load_settings_from_db,
)
from app.schemas.operator_settings import OperatorSettingsOut, OperatorSettingsUpdate
from app.settings_keys import ALLOW_PUBLIC_REGISTRATION, HEARTBEAT_STALE_MINUTES
from app.settings_service import upsert_setting

router = APIRouter(prefix="/settings", tags=["settings"])


def _settings_out() -> OperatorSettingsOut:
    return OperatorSettingsOut(
        cors_origins=get_cors_origins(),
        deployment_stack_mode=get_deployment_stack_mode(),
        allow_public_registration=is_public_registration_allowed(),
        access_token_expire_minutes=get_access_token_expire_minutes(),
        external_log_paths=get_external_log_paths(),
        jwt_algorithm=get_jwt_algorithm(),
        heartbeat_stale_minutes=get_heartbeat_stale_minutes(),
    )


@router.get("", response_model=OperatorSettingsOut)
async def get_operator_settings(_: Annotated[User, Depends(get_current_user)]) -> OperatorSettingsOut:
    """Non-secret settings for the operator UI (JWT secret is never exposed)."""
    return _settings_out()


@router.put("", response_model=OperatorSettingsOut)
async def update_operator_settings(
    request: Request,
    body: OperatorSettingsUpdate,
    actor: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> OperatorSettingsOut:
    if body.allow_public_registration is None and body.heartbeat_stale_minutes is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No settings to update")

    if body.allow_public_registration is not None:
        await upsert_setting(
            db,
            ALLOW_PUBLIC_REGISTRATION,
            "true" if body.allow_public_registration else "false",
        )
    if body.heartbeat_stale_minutes is not None:
        await upsert_setting(db, HEARTBEAT_STALE_MINUTES, str(body.heartbeat_stale_minutes))

    await load_settings_from_db(db)
    await write_audit(
        db,
        action="settings.update",
        actor_user_id=actor.id,
        resource_type="app_settings",
        resource_id=None,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return _settings_out()
