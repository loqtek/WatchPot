"""IP extraction, geo lookup, and threat IP tracking."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.enrichment.config import load_config
from app.enrichment.ip_gather import gather_ips_from_event, observation_ips
from app.enrichment.ip_utils import is_public_ip
from app.models.event import Event
from app.models.threat_ip import ThreatIp
from app.time_utils import ensure_utc, utc_now

log = logging.getLogger("watchpot.enrichment.ip_intel")


async def lookup_ip_geo(ip: str) -> dict[str, Any]:
    """Free geo lookup via ip-api.com (no key, 45 req/min)."""
    url = f"http://ip-api.com/json/{ip}?fields=status,message,country,countryCode,regionName,city,isp,org,as,lat,lon,hosting,proxy,query"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return {"ok": False, "error": f"HTTP {resp.status_code}"}
            data = resp.json()
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}

    if data.get("status") != "success":
        return {"ok": False, "error": str(data.get("message") or "lookup failed")}

    asn_raw = str(data.get("as") or "")
    asn_num = None
    if asn_raw.upper().startswith("AS"):
        try:
            asn_num = int(asn_raw.split()[0][2:])
        except ValueError:
            asn_num = None

    return {
        "ok": True,
        "country": data.get("country"),
        "country_code": data.get("countryCode"),
        "region": data.get("regionName"),
        "city": data.get("city"),
        "isp": data.get("isp"),
        "org": data.get("org"),
        "asn": asn_num,
        "asn_label": asn_raw,
        "lat": data.get("lat"),
        "lon": data.get("lon"),
        "is_hosting": bool(data.get("hosting")),
        "is_proxy": bool(data.get("proxy")),
    }


async def lookup_ip_abuseipdb(ip: str, api_key: str) -> dict[str, Any]:
    if not api_key.strip():
        return {"ok": False, "skipped": True}
    url = "https://api.abuseipdb.com/api/v2/check"
    headers = {"Key": api_key.strip(), "Accept": "application/json"}
    params = {"ipAddress": ip, "maxAgeInDays": 90}
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(url, headers=headers, params=params)
            if resp.status_code != 200:
                return {"ok": False, "error": f"HTTP {resp.status_code}"}
            data = resp.json().get("data") or {}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}

    return {
        "ok": True,
        "abuse_score": int(data.get("abuseConfidenceScore") or 0),
        "total_reports": int(data.get("totalReports") or 0),
        "country": data.get("countryCode"),
        "isp": data.get("isp"),
        "domain": data.get("domain"),
        "is_tor": bool(data.get("isTor")),
        "usage_type": data.get("usageType"),
    }


def _merge_unique(existing: list | None, new_items: list[str]) -> list[str]:
    out = list(existing or [])
    for item in new_items:
        if item and item not in out:
            out.append(item)
    return out


async def record_ips_from_event(
    session: AsyncSession,
    *,
    pot_id: UUID,
    ips: list[str],
    attack_types: list[str] | None = None,
    cve_ids: list[str] | None = None,
    tools: list[str] | None = None,
    has_match: bool = False,
    cfg: dict[str, Any] | None = None,
) -> list[str]:
    if not ips:
        return []
    config = cfg or await load_config(session)
    if not config.get("ip_tracking_enabled", True):
        return []

    now = utc_now()
    pot_str = str(pot_id)
    updated_ips: list[str] = []
    lookup_enabled = bool(config.get("ip_lookup_enabled", True))
    abuse_key = str(config.get("abuseipdb_api_key") or "").strip()
    lookup_cooldown_h = int(config.get("ip_lookup_cooldown_hours") or 24)

    for ip in ips:
        result = await session.execute(select(ThreatIp).where(ThreatIp.ip_address == ip))
        row = result.scalar_one_or_none()
        if row is None:
            row = ThreatIp(
                ip_address=ip,
                status="suspicious" if has_match else "observed",
                hit_count=1,
                match_count=1 if has_match else 0,
                pot_ids=[pot_str],
                attack_types=list(attack_types or []),
                cve_ids=list(cve_ids or []),
                tools=list(tools or []),
                first_seen_at=now,
                last_seen_at=now,
            )
            session.add(row)
        else:
            row.hit_count += 1
            if has_match:
                row.match_count += 1
                if row.status == "observed":
                    row.status = "suspicious"
            row.pot_ids = _merge_unique(row.pot_ids, [pot_str])
            row.attack_types = _merge_unique(row.attack_types, list(attack_types or []))
            row.cve_ids = _merge_unique(row.cve_ids, list(cve_ids or []))
            row.tools = _merge_unique(row.tools, list(tools or []))
            row.last_seen_at = now

        last_lookup = ensure_utc(row.last_lookup_at)
        should_lookup = lookup_enabled and (
            last_lookup is None
            or last_lookup < now - timedelta(hours=lookup_cooldown_h)
            or row.lookup_status in (None, "failed")
        )
        if should_lookup:
            geo = await lookup_ip_geo(ip)
            if geo.get("ok"):
                row.geo = {k: geo[k] for k in geo if k not in ("ok", "error")}
                row.is_hosting = geo.get("is_hosting")
                row.lookup_status = "ok"
            else:
                row.lookup_status = "failed"
            row.last_lookup_at = now

            if abuse_key:
                abuse = await lookup_ip_abuseipdb(ip, abuse_key)
                if abuse.get("ok"):
                    row.abuse_score = abuse.get("abuse_score")
                    row.is_tor = abuse.get("is_tor")
                    if int(abuse.get("abuse_score") or 0) >= 50 and row.status not in ("watchlist", "allowlisted"):
                        row.status = "suspicious"

        updated_ips.append(ip)

    await session.flush()
    return updated_ips


async def track_ips_for_events(session: AsyncSession, event_ids: list[UUID]) -> int:
    """Unified IP tracking — runs independently of fingerprint enrichment."""
    if not event_ids:
        return 0

    cfg = await load_config(session)
    if not cfg.get("ip_tracking_enabled", True):
        return 0

    track_channels = set(cfg.get("ip_track_channels") or ["runtime", "infra"])
    skip_types = set(cfg.get("skip_event_types") or [])
    result = await session.execute(select(Event).where(Event.id.in_(event_ids)))
    events = list(result.scalars().all())
    tracked = 0

    for ev in events:
        is_connection_event = ev.event_type == "watchpot.agent.connections"
        if ev.channel not in track_channels and not is_connection_event:
            continue
        if ev.event_type in skip_types and not is_connection_event:
            continue

        enr = (ev.payload or {}).get("enrichment") if isinstance(ev.payload, dict) else {}
        has_match = isinstance(enr, dict) and enr.get("status") in ("matched", "low_confidence")

        observations = gather_ips_from_event(
            raw_log=ev.raw_log,
            payload=ev.payload,
            service_name=ev.service_name,
            event_type=ev.event_type,
        )
        ips = observation_ips(observations)
        if not ips:
            continue

        payload = dict(ev.payload or {})
        payload["source_ips"] = ips
        if observations:
            payload["ip_observations"] = [
                {
                    "ip": o.ip,
                    "source": o.source,
                    "port": o.port,
                    "container": o.container,
                }
                for o in observations[:20]
            ]
        ev.payload = payload
        flag_modified(ev, "payload")

        await record_ips_from_event(
            session,
            pot_id=ev.pot_id,
            ips=ips,
            attack_types=enr.get("attack_types") if isinstance(enr, dict) else None,
            cve_ids=enr.get("cve_ids") if isinstance(enr, dict) else None,
            tools=enr.get("tools") if isinstance(enr, dict) else None,
            has_match=has_match or is_connection_event,
            cfg=cfg,
        )
        tracked += len(ips)

    return tracked


def schedule_ip_tracking(event_ids: list[UUID]) -> None:
    """Fire-and-forget IP tracking after event ingest."""

    async def _run() -> None:
        try:
            from app.database import async_session_factory

            async with async_session_factory() as session:
                n = await track_ips_for_events(session, event_ids)
                await session.commit()
                if n:
                    log.debug("tracked %s IP observation(s)", n)
        except Exception:
            log.exception("background IP tracking failed")

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_run())
    except RuntimeError:
        pass


async def scan_events_for_ips(
    session: AsyncSession,
    *,
    lookback_hours: int = 168,
    limit: int = 500,
) -> tuple[int, int]:
    """Backfill threat_ips from historical events."""
    since = utc_now() - timedelta(hours=lookback_hours)
    q = (
        select(Event)
        .where(Event.received_at >= since, Event.channel.in_(("runtime", "infra")))
        .order_by(Event.received_at.desc())
        .limit(limit)
    )
    rows = list((await session.execute(q)).scalars().all())
    cfg = await load_config(session)
    ips_found = 0
    for ev in rows:
        enr = (ev.payload or {}).get("enrichment") if isinstance(ev.payload, dict) else {}
        has_match = isinstance(enr, dict) and enr.get("status") in ("matched", "low_confidence")
        observations = gather_ips_from_event(
            raw_log=ev.raw_log,
            payload=ev.payload,
            service_name=ev.service_name,
            event_type=ev.event_type,
        )
        ips = observation_ips(observations)
        if not ips:
            continue
        ips_found += len(ips)
        await record_ips_from_event(
            session,
            pot_id=ev.pot_id,
            ips=ips,
            attack_types=enr.get("attack_types") if isinstance(enr, dict) else None,
            cve_ids=enr.get("cve_ids") if isinstance(enr, dict) else None,
            tools=enr.get("tools") if isinstance(enr, dict) else None,
            has_match=has_match or ev.event_type == "watchpot.agent.connections",
            cfg=cfg,
        )
    return len(rows), ips_found


async def ip_intel_stats(session: AsyncSession) -> dict[str, Any]:
    total = int((await session.execute(select(func.count()).select_from(ThreatIp))).scalar_one())
    suspicious = int(
        (
            await session.execute(
                select(func.count()).select_from(ThreatIp).where(ThreatIp.status == "suspicious")
            )
        ).scalar_one()
    )
    watchlist = int(
        (
            await session.execute(
                select(func.count()).select_from(ThreatIp).where(ThreatIp.status == "watchlist")
            )
        ).scalar_one()
    )
    with_geo = int(
        (
            await session.execute(
                select(func.count()).select_from(ThreatIp).where(ThreatIp.geo.is_not(None))
            )
        ).scalar_one()
    )
    recent = (
        await session.execute(
            select(ThreatIp).order_by(ThreatIp.last_seen_at.desc()).limit(8)
        )
    ).scalars().all()

    country_counts: dict[str, int] = {}
    for row in (await session.execute(select(ThreatIp.geo, ThreatIp.hit_count).where(ThreatIp.geo.is_not(None)))).all():
        geo, hits = row[0], int(row[1] or 1)
        if isinstance(geo, dict):
            cc = str(geo.get("country_code") or geo.get("country") or "??")
            country_counts[cc] = country_counts.get(cc, 0) + hits

    top_countries = sorted(country_counts.items(), key=lambda x: x[1], reverse=True)[:10]
    return {
        "total": total,
        "suspicious": suspicious,
        "watchlist": watchlist,
        "with_geo": with_geo,
        "top_countries": [{"key": k, "count": v} for k, v in top_countries],
        "recent": [
            {
                "ip_address": r.ip_address,
                "status": r.status,
                "hit_count": r.hit_count,
                "last_seen_at": r.last_seen_at.isoformat() if r.last_seen_at else None,
                "country": (r.geo or {}).get("country") if isinstance(r.geo, dict) else None,
            }
            for r in recent
        ],
    }
