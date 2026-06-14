"""Integration definitions stored in app_settings as JSON (key: siem_integrations)."""

from __future__ import annotations

import copy
import json
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field

ProviderKind = Literal["grafana_loki", "grafana_alerting", "zabbix", "wazuh"]

# Stable IDs so defaults, migration, and UI stay aligned across restarts.
STABLE_INTEGRATION_IDS: dict[ProviderKind, str] = {
    "grafana_loki": "a1000001-0001-4001-8001-000000000001",
    "grafana_alerting": "a1000002-0002-4002-8002-000000000002",
    "zabbix": "a1000003-0003-4003-8003-000000000003",
    "wazuh": "a1000004-0004-4004-8004-000000000004",
}


class IntegrationConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    provider: ProviderKind
    enabled: bool = False
    channels: list[str] = Field(default_factory=lambda: ["runtime", "infra"])
    config: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "ignore"}


class IntegrationsDocument(BaseModel):
    version: int = 1
    integrations: list[IntegrationConfig] = Field(default_factory=list)


def _template(
    name: str,
    provider: ProviderKind,
    *,
    config: dict[str, Any],
    enabled: bool = False,
) -> IntegrationConfig:
    return IntegrationConfig(
        id=STABLE_INTEGRATION_IDS[provider],
        name=name,
        provider=provider,
        enabled=enabled,
        channels=["runtime", "infra"],
        config=config,
    )


DEFAULT_INTEGRATIONS = IntegrationsDocument(
    integrations=[
        _template(
            "Grafana Loki",
            "grafana_loki",
            config={
                "push_url": "http://localhost:3100/loki/api/v1/push",
                "tenant_id": "",
                "username": "",
                "password": "",
                "extra_labels": {"job": "watchpot", "source": "watchpot"},
                "notes": "POST JSON to Loki push API. Timestamps are nanoseconds UTC. Requires Loki or Grafana Cloud Logs.",
            },
        ),
        _template(
            "Grafana Alerting webhook",
            "grafana_alerting",
            config={
                "webhook_url": "https://your-grafana.example/api/v1/webhooks/xxx",
                "bearer_token": "",
                "notes": "Contact point / universal webhook in Grafana Alerting. Receives JSON alert-style payloads.",
            },
        ),
        _template(
            "Zabbix trapper",
            "zabbix",
            config={
                "connection_mode": "sender",
                "server_host": "",
                "server_port": 10051,
                "api_url": "",
                "api_token": "",
                "zabbix_host": "watchpot",
                "item_key": "watchpot.event",
                "notes": "Sender needs Zabbix server trapper port 10051 (not agent 10050). Use API mode if only the web UI is reachable.",
            },
        ),
        _template(
            "Wazuh indexer",
            "wazuh",
            config={
                "base_url": "https://127.0.0.1:9200",
                "index": "watchpot-events",
                "username": "admin",
                "password": "",
                "verify_ssl": False,
                "notes": "OpenSearch-compatible document API (bulk index). Use indexer credentials; index is created automatically.",
            },
        ),
    ]
)


_integrations_cache: IntegrationsDocument = copy.deepcopy(DEFAULT_INTEGRATIONS)

SECRET_KEYS = frozenset({"password", "bearer_token", "api_token"})


def get_integrations() -> IntegrationsDocument:
    return copy.deepcopy(_integrations_cache)


def config_to_json(doc: IntegrationsDocument) -> str:
    return doc.model_dump_json()


def _migrate_legacy_providers(data: dict[str, Any]) -> IntegrationsDocument | None:
    """Old siem_integrations shape: { forward_channels, providers: { zabbix: {...} } }."""
    providers = data.get("providers")
    if not isinstance(providers, dict):
        return None

    channels = data.get("forward_channels")
    if not isinstance(channels, list) or not channels:
        channels = ["runtime", "infra"]

    def _zabbix_cfg(p: dict[str, Any]) -> dict[str, Any]:
        mode = (p.get("mode") or "sender").strip().lower()
        api_url = (p.get("api_url") or "").strip()
        connection_mode = "api" if mode in ("api", "webhook") and api_url else "sender"
        if mode == "webhook" and not api_url:
            connection_mode = "sender"
        return {
            "connection_mode": connection_mode,
            "server_host": (p.get("server_host") or "").strip(),
            "server_port": int(p.get("server_port") or 10051),
            "api_url": api_url,
            "api_token": p.get("api_token") or "",
            "zabbix_host": (p.get("host") or p.get("zabbix_host") or "watchpot").strip(),
            "item_key": (p.get("item_key") or "watchpot.event").strip(),
        }

    builders: list[tuple[ProviderKind, str, Any]] = [
        (
            "grafana_loki",
            "Grafana Loki",
            lambda p: {
                "push_url": (p.get("url") or p.get("push_url") or "").strip(),
                "tenant_id": p.get("tenant_id") or "",
                "username": p.get("username") or "",
                "password": p.get("password") or "",
                "extra_labels": p.get("labels") or p.get("extra_labels") or {"job": "watchpot"},
            },
        ),
        (
            "grafana_alerting",
            "Grafana Alerting webhook",
            lambda p: {
                "webhook_url": (p.get("url") or p.get("webhook_url") or "").strip(),
                "bearer_token": p.get("auth_bearer") or p.get("bearer_token") or "",
            },
        ),
        ("zabbix", "Zabbix trapper", _zabbix_cfg),
        (
            "wazuh",
            "Wazuh indexer",
            lambda p: {
                "base_url": (p.get("indexer_url") or p.get("api_url") or p.get("base_url") or "").strip(),
                "index": (p.get("index_pattern") or p.get("index") or "watchpot-events").strip(),
                "username": p.get("api_user") or p.get("username") or "",
                "password": p.get("api_password") or p.get("password") or "",
                "verify_ssl": bool(p.get("verify_ssl", False)),
            },
        ),
    ]

    integrations: list[IntegrationConfig] = []
    for provider, default_name, cfg_fn in builders:
        raw_p = providers.get(provider)
        if not isinstance(raw_p, dict):
            continue
        integrations.append(
            IntegrationConfig(
                id=STABLE_INTEGRATION_IDS[provider],
                name=(raw_p.get("name") or default_name).strip(),
                provider=provider,
                enabled=bool(raw_p.get("enabled")),
                channels=[str(c) for c in channels],
                config=cfg_fn(raw_p),
            )
        )

    if not integrations:
        return None
    return IntegrationsDocument(version=1, integrations=integrations)


def parse_integrations_json(raw: str | None) -> IntegrationsDocument:
    if not raw:
        return copy.deepcopy(DEFAULT_INTEGRATIONS)
    try:
        data = json.loads(raw)
        if isinstance(data, dict) and "integrations" in data:
            doc = IntegrationsDocument.model_validate(data)
            # Normalize unknown IDs to stable provider IDs for the four built-ins.
            for i in doc.integrations:
                stable = STABLE_INTEGRATION_IDS.get(i.provider)
                if stable and i.id != stable:
                    i.id = stable
            return doc
        if isinstance(data, list):
            return IntegrationsDocument(
                integrations=[IntegrationConfig.model_validate(i) for i in data],
            )
        if isinstance(data, dict):
            migrated = _migrate_legacy_providers(data)
            if migrated is not None:
                return migrated
    except (json.JSONDecodeError, ValueError):
        pass
    return copy.deepcopy(DEFAULT_INTEGRATIONS)


def needs_integrations_migration(raw: str | None) -> bool:
    if not raw:
        return False
    try:
        data = json.loads(raw)
        return isinstance(data, dict) and "providers" in data and "integrations" not in data
    except json.JSONDecodeError:
        return False


def reload_integrations_from_rows(rows: dict[str, str]) -> None:
    global _integrations_cache
    from app.settings_keys import SIEM_INTEGRATIONS

    _integrations_cache = parse_integrations_json(rows.get(SIEM_INTEGRATIONS))


def redact_integration(i: IntegrationConfig) -> dict[str, Any]:
    d = i.model_dump()
    cfg = dict(d.get("config") or {})
    for key in SECRET_KEYS:
        if cfg.get(key):
            cfg[key] = "••••••••"
    d["config"] = cfg
    return d


def merge_secrets(incoming: IntegrationConfig, existing: IntegrationConfig | None) -> IntegrationConfig:
    if existing is None:
        return incoming
    new_cfg = dict(incoming.config)
    old_cfg = existing.config
    for key in SECRET_KEYS:
        val = new_cfg.get(key)
        if val in (None, "", "••••••••") and old_cfg.get(key):
            new_cfg[key] = old_cfg[key]
    incoming.config = new_cfg
    return incoming
