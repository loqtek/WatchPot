"""Block operator-configured HTTP targets that resolve to loopback, link-local, or cloud metadata."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from app.config import get_env_settings

METADATA_HOSTS = frozenset(
    {
        "metadata.google.internal",
        "metadata.goog",
        "metadata",
        "instance-data",
        "kubernetes.default",
        "kubernetes.default.svc",
    }
)
METADATA_IPS = frozenset(
    {
        ipaddress.ip_address("169.254.169.254"),
        ipaddress.ip_address("169.254.170.2"),
        ipaddress.ip_address("100.100.100.200"),
        ipaddress.ip_address("fd00:ec2::254"),
    }
)

INTEGRATION_URL_KEYS = ("push_url", "webhook_url", "base_url", "api_url")


class UnsafeTargetError(ValueError):
    pass


def _allow_loopback() -> bool:
    return get_env_settings().integration_allow_loopback_enabled()


def _ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> str | None:
    if ip in METADATA_IPS:
        return "cloud metadata address"
    if ip.is_loopback and not _allow_loopback():
        return "loopback address"
    if ip.is_link_local:
        return "link-local address"
    if ip.is_unspecified:
        return "unspecified address"
    if ip.is_multicast:
        return "multicast address"
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        return _ip_blocked(mapped)
    return None


def _hostname_blocked(host: str) -> str | None:
    h = host.strip("[]").lower().rstrip(".")
    if h in METADATA_HOSTS or h.endswith(".metadata.google.internal"):
        return "cloud metadata hostname"
    return None


def resolve_host_ips(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    ips: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    seen: set[str] = set()
    for info in infos:
        addr = info[4][0]
        if addr in seen:
            continue
        seen.add(addr)
        ips.append(ipaddress.ip_address(addr))
    if not ips:
        raise UnsafeTargetError(f"Could not resolve host {host!r}")
    return ips


def assert_safe_host(host: str, *, what: str = "target") -> None:
    raw = (host or "").strip()
    if not raw:
        raise UnsafeTargetError(f"{what} is empty")
    if raw.startswith("[") and "]" in raw:
        raw = raw[1 : raw.index("]")]
    reason = _hostname_blocked(raw)
    if reason:
        raise UnsafeTargetError(f"{what} is blocked ({reason})")
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        try:
            ips = resolve_host_ips(raw)
        except socket.gaierror as e:
            raise UnsafeTargetError(f"{what} hostname {raw!r} could not be resolved") from e
        for ip in ips:
            blocked = _ip_blocked(ip)
            if blocked:
                raise UnsafeTargetError(f"{what} resolves to a blocked {blocked} ({ip})")
        return
    blocked = _ip_blocked(ip)
    if blocked:
        raise UnsafeTargetError(f"{what} is a blocked {blocked}")


def assert_safe_url(url: str, *, what: str = "URL") -> None:
    raw = (url or "").strip()
    if not raw:
        raise UnsafeTargetError(f"{what} is empty")
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeTargetError(f"{what} must use http or https")
    host = parsed.hostname
    if not host:
        raise UnsafeTargetError(f"{what} is missing a hostname")
    if parsed.username or parsed.password:
        raise UnsafeTargetError(f"{what} must not embed credentials in the URL")
    assert_safe_host(host, what=what)


def assert_safe_integration_config(provider: str, config: dict) -> None:
    cfg = config or {}
    for key in INTEGRATION_URL_KEYS:
        val = cfg.get(key)
        if isinstance(val, str) and val.strip():
            assert_safe_url(val, what=f"{provider} {key}")
    host = cfg.get("server_host")
    if isinstance(host, str) and host.strip():
        assert_safe_host(host.strip(), what=f"{provider} server_host")
