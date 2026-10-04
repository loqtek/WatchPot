from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserAdminOut(BaseModel):
    id: UUID
    email: str
    username: str | None
    is_active: bool
    is_admin: bool
    timezone: str
    must_change_password: bool = False
    totp_enabled: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class AdminUserCreate(BaseModel):
    email: EmailStr
    username: str | None = Field(
        default=None,
        max_length=64,
        pattern=r"^[a-zA-Z0-9._-]+$",
    )
    password: str = Field(min_length=8)
    is_admin: bool = False

    @field_validator("username", mode="before")
    @classmethod
    def empty_username_to_none(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip():
            return None
        return v


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    username: str | None = Field(
        default=None,
        max_length=64,
        pattern=r"^[a-zA-Z0-9._-]+$",
    )
    is_active: bool | None = None
    is_admin: bool | None = None

    @field_validator("username", mode="before")
    @classmethod
    def empty_username_to_none(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip():
            return None
        return v


class AdminPasswordReset(BaseModel):
    new_password: str = Field(min_length=8)
