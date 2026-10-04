"""Time-based one-time passwords and one-time recovery codes."""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import secrets

import pyotp
import qrcode
import qrcode.image.svg

ISSUER = "watchPot"
RECOVERY_COUNT = 8


def new_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(secret: str, account: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account, issuer_name=ISSUER)


def qr_svg(data: str) -> str:
    image = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage, border=2)
    buf = io.BytesIO()
    image.save(buf)
    return buf.getvalue().decode("utf-8")


def verify_totp(secret: str | None, code: str) -> bool:
    raw = "".join((code or "").split())
    if not secret or not raw.isdigit():
        return False
    try:
        return bool(pyotp.TOTP(secret).verify(raw, valid_window=1))
    except Exception:
        return False


def _normalize_recovery(code: str) -> str:
    return "".join((code or "").split()).lower()


def hash_recovery(code: str) -> str:
    return hashlib.sha256(_normalize_recovery(code).encode("utf-8")).hexdigest()


def new_recovery_codes(count: int = RECOVERY_COUNT) -> tuple[list[str], str]:
    plain: list[str] = []
    hashes: list[str] = []
    for _ in range(count):
        raw = secrets.token_hex(4)
        code = f"{raw[:4]}-{raw[4:]}"
        plain.append(code)
        hashes.append(hash_recovery(code))
    return plain, json.dumps(hashes)


def consume_recovery(hashes_json: str | None, code: str) -> str | None:
    """Return updated JSON when `code` matches one stored hash, else None."""
    try:
        hashes = json.loads(hashes_json or "[]")
    except json.JSONDecodeError:
        return None
    if not isinstance(hashes, list):
        return None
    digest = hash_recovery(code)
    kept: list[str] = []
    matched = False
    for item in hashes:
        if not isinstance(item, str):
            continue
        if not matched and hmac.compare_digest(item, digest):
            matched = True
            continue
        kept.append(item)
    if not matched:
        return None
    return json.dumps(kept)
