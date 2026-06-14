"""Wazuh indexer (OpenSearch) document indexing."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import httpx


def _index_name(cfg: dict[str, Any]) -> str:
    base = (cfg.get("index") or "watchpot-events").strip().lower()
    return base


def _normalize_base_url(base: str, index: str) -> str:
    """Strip accidental index paths or API suffixes from the configured base URL."""
    url = base.strip().rstrip("/")
    index = index.strip().strip("/")
    suffixes = ["/_doc", "/_bulk"]
    if index:
        suffixes.extend([f"/{index}", f"/{index}/_doc"])
    for suffix in suffixes:
        if url.endswith(suffix):
            url = url[: -len(suffix)].rstrip("/")
    return url


def _looks_like_manager_api(body: str) -> bool:
    return '"statusCode"' in body and '"error"' in body and '"message"' in body


def _opensearch_error_reason(body: str) -> str | None:
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return None
    err = data.get("error")
    if isinstance(err, dict):
        return str(err.get("reason") or err.get("type") or "")
    return None


def build_wazuh_document(event: dict[str, Any]) -> dict[str, Any]:
    received = event.get("received_at")
    ts = received
    if received:
        try:
            dt = datetime.fromisoformat(str(received).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            ts = dt.isoformat()
        except ValueError:
            ts = received
    return {
        "@timestamp": ts or datetime.now(timezone.utc).isoformat(),
        "event_type": event.get("event_type"),
        "severity": event.get("severity"),
        "source": event.get("source"),
        "channel": event.get("channel"),
        "pot_id": event.get("pot_id"),
        "stack_id": event.get("stack_id"),
        "service_name": event.get("service_name"),
        "payload": event.get("payload"),
        "raw_log": event.get("raw_log"),
        "watchpot": True,
    }


async def _probe_indexer(
    wazuh_client: httpx.AsyncClient,
    base: str,
    auth: tuple[str, str] | None,
) -> tuple[bool, str]:
    try:
        r = await wazuh_client.get(f"{base}/", auth=auth)
    except httpx.RequestError as exc:
        return False, f"Cannot reach Wazuh indexer at {base}: {exc}"

    if r.status_code >= 400:
        if _looks_like_manager_api(r.text):
            return (
                False,
                "URL points to the Wazuh manager or dashboard API, not the indexer. "
                "Use https://<host>:9200 (OpenSearch), not port 55000 or the dashboard URL.",
            )
        return False, f"Indexer probe HTTP {r.status_code}: {r.text[:400]}"

    try:
        data = r.json()
    except json.JSONDecodeError:
        return (
            False,
            f"Service at {base} did not return OpenSearch JSON. "
            "Confirm the indexer URL (typically https://host:9200).",
        )

    if not any(key in data for key in ("tagline", "cluster_name", "version")):
        return (
            False,
            f"Service at {base} is not an OpenSearch/Wazuh indexer API. "
            "Use the indexer base URL on port 9200.",
        )
    return True, "ok"


async def _ensure_index(
    wazuh_client: httpx.AsyncClient,
    base: str,
    index: str,
    auth: tuple[str, str] | None,
) -> tuple[bool, str]:
    head = await wazuh_client.head(f"{base}/{index}", auth=auth)
    if head.status_code == 200:
        return True, "exists"

    if head.status_code != 404:
        return False, f"Index check HTTP {head.status_code}: {head.text[:400]}"

    create = await wazuh_client.put(
        f"{base}/{index}",
        auth=auth,
        headers={"Content-Type": "application/json"},
        json={"settings": {"number_of_shards": 1, "number_of_replicas": 0}},
    )
    if create.status_code in (200, 201):
        return True, "created"
    return False, f"Could not create index '{index}': HTTP {create.status_code}: {create.text[:400]}"


def _format_index_error(status: int, body: str, base: str, index: str) -> str:
    if _looks_like_manager_api(body):
        return (
            "Wazuh indexer HTTP 404: request hit the manager/dashboard API instead of OpenSearch. "
            f"Set base URL to https://<host>:9200 (not {base})."
        )
    reason = _opensearch_error_reason(body)
    if reason:
        return f"Wazuh indexer HTTP {status}: {reason}"
    return f"Wazuh indexer HTTP {status}: {body[:500]}"


async def send_wazuh(
    client: httpx.AsyncClient,
    event: dict[str, Any],
    cfg: dict[str, Any],
) -> tuple[bool, str]:
    raw_base = (cfg.get("base_url") or "").strip()
    if not raw_base:
        return False, "base_url is required"

    index = _index_name(cfg)
    base = _normalize_base_url(raw_base, index)
    if not base:
        return False, "base_url is required"

    user = (cfg.get("username") or "").strip()
    password = cfg.get("password") or ""
    auth = (user, password) if user else None
    verify = bool(cfg.get("verify_ssl", True))

    body = build_wazuh_document(event)
    timeout = client.timeout if client.timeout is not None else httpx.Timeout(15.0)
    url = f"{base}/{index}/_doc"

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, verify=verify) as wazuh_client:
        ok, probe_msg = await _probe_indexer(wazuh_client, base, auth)
        if not ok:
            return False, probe_msg

        ok, index_msg = await _ensure_index(wazuh_client, base, index, auth)
        if not ok:
            return False, index_msg

        r = await wazuh_client.post(
            url,
            json=body,
            auth=auth,
            headers={"Content-Type": "application/json"},
        )

    if r.status_code >= 400:
        return False, _format_index_error(r.status_code, r.text, base, index)
    return True, f"Wazuh indexer HTTP {r.status_code} (index {index_msg})"
