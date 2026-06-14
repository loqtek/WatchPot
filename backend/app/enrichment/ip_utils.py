"""Shared IP helpers (no imports from other enrichment modules)."""

from __future__ import annotations

import ipaddress


def is_public_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str.strip())
    except ValueError:
        return False
    return bool(
        ip.is_global
        and not ip.is_multicast
        and not ip.is_reserved
        and not ip.is_private
        and not ip.is_loopback
        and not ip.is_link_local
    )
