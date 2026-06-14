from uuid import UUID

from pydantic import AliasChoices, BaseModel, EmailStr, Field, field_validator


class UserCreate(BaseModel):
    email: EmailStr
    username: str | None = Field(
        default=None,
        max_length=64,
        pattern=r"^[a-zA-Z0-9._-]+$",
        description="Optional unique login name",
    )
    password: str = Field(min_length=8)

    @field_validator("username", mode="before")
    @classmethod
    def empty_username_to_none(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip():
            return None
        return v


class UserLogin(BaseModel):
    identifier: str = Field(
        min_length=1,
        max_length=320,
        validation_alias=AliasChoices("identifier", "email", "username"),
        description="Email, username, or wpadmin for the default admin",
    )
    password: str


class UserOut(BaseModel):
    id: UUID
    email: str
    username: str | None
    is_active: bool
    timezone: str

    model_config = {"from_attributes": True}


class ProfileUpdate(BaseModel):
    timezone: str | None = Field(default=None, max_length=64)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    local_agent: dict[str, object] | None = None


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8)
