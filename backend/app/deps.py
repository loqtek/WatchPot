import uuid
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.pot import Pot
from app.models.user import User
from app.security import decode_access_token, verify_secret

security = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
) -> User:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_access_token(creds.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    try:
        user_id = uuid.UUID(payload["sub"])
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid subject")
    result = await db.execute(select(User).where(User.id == user_id, User.is_active.is_(True)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    request.state.user_id = str(user.id)
    return user


def _pot_id_header(
    x_watchpot_pot_id: Annotated[str | None, Header()] = None,
    x_watchpot_node_id: Annotated[str | None, Header()] = None,
) -> str | None:
    """Prefer X-WatchPot-Pot-Id; accept legacy X-WatchPot-Node-Id."""
    return (x_watchpot_pot_id or x_watchpot_node_id or "").strip() or None


async def get_agent_pot(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
    raw_pot_id: Annotated[str | None, Depends(_pot_id_header)] = None,
) -> Pot:
    if not raw_pot_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-WatchPot-Pot-Id header required (legacy X-WatchPot-Node-Id also accepted)",
        )
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Agent bearer token required")
    try:
        pot_uuid = uuid.UUID(raw_pot_id.strip())
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid X-WatchPot-Pot-Id")
    token = authorization.split(" ", 1)[1].strip()
    result = await db.execute(select(Pot).where(Pot.id == pot_uuid))
    pot = result.scalar_one_or_none()
    if pot is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown pot id")
    if not verify_secret(token, pot.agent_key_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Agent token does not match this pot — use the key from the same registration or rotate the key in the UI",
        )
    request.state.pot_id = str(pot.id)
    return pot
