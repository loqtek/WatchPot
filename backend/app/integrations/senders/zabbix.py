"""Zabbix trapper: TCP sender (port 10051) or JSON-RPC history.push API."""

from __future__ import annotations

import asyncio
import errno
import json
import struct
import time
from datetime import datetime, timezone
from typing import Any

import httpx


def _clock_ns(iso_or_none: str | None) -> tuple[int, int]:
    if iso_or_none:
        try:
            dt = datetime.fromisoformat(iso_or_none.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            ts = dt.timestamp()
            sec = int(ts)
            ns = int((ts - sec) * 1_000_000_000)
            return sec, ns
        except ValueError:
            pass
    now = time.time()
    sec = int(now)
    return sec, int((now - sec) * 1_000_000_000)


# Extra trapper keys (included in deploy/zabbix/watchpot-template.xml)
KEY_SEVERITY_NUM = "watchpot.severity.num"
KEY_EVENTS_COUNT = "watchpot.events.count"


def severity_to_num(severity: str | None) -> int:
    s = (severity or "info").lower()
    return {
        "debug": 0,
        "info": 1,
        "warning": 2,
        "warn": 2,
        "error": 3,
        "high": 3,
        "critical": 4,
    }.get(s, 1)


def build_zabbix_value(event: dict[str, Any]) -> str:
    return json.dumps(
        {
            "event_type": event.get("event_type"),
            "severity": event.get("severity"),
            "severity_num": severity_to_num(event.get("severity")),
            "channel": event.get("channel"),
            "pot_id": event.get("pot_id"),
            "payload": event.get("payload"),
            "raw_log": (event.get("raw_log") or "")[:2000],
        },
        default=str,
    )


def build_zabbix_data_entries(event: dict[str, Any], cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """One event → JSON + numeric metrics for Zabbix graphs (matches import template)."""
    zabbix_host = (cfg.get("zabbix_host") or "watchpot").strip()
    item_key = (cfg.get("item_key") or "watchpot.event").strip()
    clock, ns = _clock_ns(event.get("received_at"))
    return [
        {
            "host": zabbix_host,
            "key": item_key,
            "value": build_zabbix_value(event),
            "clock": clock,
            "ns": ns,
        },
        {
            "host": zabbix_host,
            "key": KEY_SEVERITY_NUM,
            "value": str(severity_to_num(event.get("severity"))),
            "clock": clock,
            "ns": ns,
        },
        {
            "host": zabbix_host,
            "key": KEY_EVENTS_COUNT,
            "value": "1",
            "clock": clock,
            "ns": ns,
        },
    ]


def build_zabbix_payload(event: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    return {"request": "sender data", "data": build_zabbix_data_entries(event, cfg)}


def build_history_push_params(event: dict[str, Any], cfg: dict[str, Any]) -> list[dict[str, Any]]:
    return build_zabbix_data_entries(event, cfg)


def _pack_request(payload: dict[str, Any]) -> bytes:
    body = json.dumps(payload).encode("utf-8")
    header = b"ZBXD\x01"
    length = struct.pack("<Q", len(body))
    return header + length + body


def _unpack_response(data: bytes) -> dict[str, Any]:
    if len(data) < 13 or data[:5] != b"ZBXD\x01":
        return {"raw": data[:200].decode("utf-8", errors="replace")}
    length = struct.unpack("<Q", data[5:13])[0]
    body = data[13 : 13 + length]
    return json.loads(body.decode("utf-8"))


def _connection_refused_message(host: str, port: int) -> str:
    return (
        f"Cannot connect to {host}:{port} (connection refused). "
        "WatchPot must reach the Zabbix server or proxy trapper port (default 10051), "
        "not the Zabbix agent port (10050). "
        "On the Zabbix server run: ss -tlnp | grep 10051 — if nothing listens, the server is not accepting sender traffic "
        "(check zabbix_server ListenPort, Docker publish 10051:10051, or firewall). "
        "Alternatively set Connection mode to API and use your Zabbix frontend URL + API token (history.push). "
        "If WatchPot API runs in Docker, use the host LAN IP (e.g. 10.0.50.32), not 127.0.0.1."
    )


async def send_zabbix_sender(event: dict[str, Any], cfg: dict[str, Any]) -> tuple[bool, str]:
    host = (cfg.get("server_host") or "").strip()
    port = int(cfg.get("server_port") or 10051)
    if not host:
        return False, (
            "server_host is required for TCP sender mode (Zabbix server IP + port 10051). "
            "If port 10051 is not open, switch Connection mode to HTTP API and set api_url + api_token instead."
        )

    packet = _pack_request(build_zabbix_payload(event, cfg))
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=10.0,
        )
    except OSError as e:
        if e.errno == errno.ECONNREFUSED:
            return False, _connection_refused_message(host, port)
        return False, f"Zabbix connect failed: {e}"
    except asyncio.TimeoutError:
        return False, f"Zabbix connect timed out to {host}:{port}"

    try:
        writer.write(packet)
        await writer.drain()
        writer.write_eof()
        raw = await asyncio.wait_for(reader.read(65536), timeout=10.0)
    except (OSError, asyncio.TimeoutError) as e:
        return False, f"Zabbix I/O failed: {e}"
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass

    if not raw:
        return False, "Zabbix empty response"
    try:
        resp = _unpack_response(raw)
    except (json.JSONDecodeError, ValueError) as e:
        return False, f"Zabbix bad response: {e}"

    if resp.get("response") != "success":
        return False, f"Zabbix rejected: {resp}"
    return True, str(resp.get("info", "success"))


async def send_zabbix_api(
    client: httpx.AsyncClient,
    event: dict[str, Any],
    cfg: dict[str, Any],
) -> tuple[bool, str]:
    url = (cfg.get("api_url") or "").strip()
    token = (cfg.get("api_token") or "").strip()
    if not url:
        return False, (
            "api_url is required for API mode (e.g. https://zabbix.example/zabbix/api_jsonrpc.php). "
            "Set Connection mode to HTTP API and paste your Zabbix JSON-RPC URL."
        )

    headers = {"Content-Type": "application/json-rpc"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    body = {
        "jsonrpc": "2.0",
        "method": "history.push",
        "params": build_history_push_params(event, cfg),
        "id": 1,
    }
    r = await client.post(url, json=body, headers=headers)
    if r.status_code >= 400:
        return False, f"Zabbix API HTTP {r.status_code}: {r.text[:500]}"

    try:
        data = r.json()
    except json.JSONDecodeError:
        return False, f"Zabbix API invalid JSON: {r.text[:300]}"

    if "error" in data:
        err = data["error"]
        return False, f"Zabbix API error: {err.get('message', err)} (code {err.get('code', '?')})"

    result = data.get("result") or {}
    if result.get("response") != "success":
        return False, f"Zabbix API unexpected result: {result}"

    errors = [d for d in (result.get("data") or []) if d.get("error")]
    if errors:
        return False, f"Zabbix API item errors: {errors}"

    return True, "Zabbix API history.push success"


def resolve_zabbix_connection_mode(cfg: dict[str, Any]) -> str:
    """Pick API vs sender from explicit mode and filled fields."""
    mode = (cfg.get("connection_mode") or "").strip().lower()
    api_url = (cfg.get("api_url") or "").strip()
    server_host = (cfg.get("server_host") or "").strip()

    if mode in ("api", "http", "webhook"):
        return "api"
    if api_url and not server_host:
        return "api"
    if mode == "sender" or server_host:
        return "sender"
    if api_url:
        return "api"
    return "sender"


async def send_zabbix(
    event: dict[str, Any],
    cfg: dict[str, Any],
    *,
    client: httpx.AsyncClient | None = None,
) -> tuple[bool, str]:
    mode = resolve_zabbix_connection_mode(cfg)
    if mode == "api":
        if client is None:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as c:
                return await send_zabbix_api(c, event, cfg)
        return await send_zabbix_api(client, event, cfg)
    return await send_zabbix_sender(event, cfg)
