from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

ProviderKind = Literal["grafana_loki", "grafana_alerting", "zabbix", "wazuh"]


class IntegrationOut(BaseModel):
    id: str
    name: str
    provider: ProviderKind
    enabled: bool
    channels: list[str]
    config: dict[str, Any]


class IntegrationsOut(BaseModel):
    version: int
    integrations: list[IntegrationOut]


class IntegrationsUpdate(BaseModel):
    version: int = 1
    integrations: list[IntegrationOut]


class IntegrationTestResult(BaseModel):
    integration_id: str
    ok: bool
    message: str


class IntegrationTestOut(BaseModel):
    results: list[IntegrationTestResult] = Field(default_factory=list)


class IntegrationTestBody(BaseModel):
    """Optional unsaved form values — used so Test connection matches what you see in the UI."""

    config: dict[str, Any] | None = None
