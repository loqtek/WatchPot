from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.settings_keys import DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_USERNAME_HINT


async def lookup_user_for_login(session: AsyncSession, raw: str) -> User | None:
    s = raw.strip()
    if not s:
        return None
    if "@" in s:
        r = await session.execute(select(User).where(func.lower(User.email) == s.lower()))
        return r.scalar_one_or_none()
    low = s.lower()
    if low == DEFAULT_ADMIN_USERNAME_HINT.lower():
        r = await session.execute(select(User).where(User.email == DEFAULT_ADMIN_EMAIL))
        return r.scalar_one_or_none()
    r = await session.execute(select(User).where(func.lower(User.username) == low))
    return r.scalar_one_or_none()
