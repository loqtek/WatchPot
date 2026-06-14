"""CVE cache management, catalog seeding, and OSV enrichment."""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.enrichment.cve_catalog import CVE_CATALOG, CVE_CATEGORIES
from app.models.cve_entry import CveEntry
from app.models.enrichment_rule import EnrichmentRule

log = logging.getLogger("watchpot.enrichment.cve")

_CVE_RE = re.compile(r"CVE-\d{4}-\d{4,7}", re.IGNORECASE)


def _entry_from_catalog(item: dict[str, Any], *, now: datetime, is_custom: bool = False) -> CveEntry:
    return CveEntry(
        cve_id=str(item["cve_id"]).upper(),
        summary=str(item["summary"]),
        severity=str(item.get("severity") or "unknown"),
        cvss_score=item.get("cvss_score"),
        category=str(item.get("category") or "other"),
        vendor=item.get("vendor"),
        product=item.get("product"),
        tags=item.get("tags") or [],
        detection_hint=item.get("detection_hint"),
        enabled=True,
        is_custom=is_custom,
        notes=item.get("notes"),
        references=item.get("references"),
        synced_at=now,
    )


async def seed_cve_cache(session: AsyncSession) -> int:
    """Insert catalog CVEs that are not yet in the database."""
    added = 0
    now = datetime.now(UTC)
    for item in CVE_CATALOG:
        cve_id = str(item["cve_id"]).upper()
        r = await session.execute(select(CveEntry).where(CveEntry.cve_id == cve_id))
        if r.scalar_one_or_none() is not None:
            continue
        session.add(_entry_from_catalog(item, now=now))
        added += 1
    if added:
        await session.flush()
    return added


async def ensure_catalog_cves(session: AsyncSession) -> int:
    """Upsert missing catalog fields on existing rows and add new catalog entries."""
    added = await seed_cve_cache(session)
    now = datetime.now(UTC)
    updated = 0
    catalog_by_id = {str(c["cve_id"]).upper(): c for c in CVE_CATALOG}
    result = await session.execute(select(CveEntry).where(CveEntry.is_custom.is_(False)))
    for row in result.scalars().all():
        cat = catalog_by_id.get(row.cve_id)
        if not cat:
            continue
        changed = False
        if not row.category or row.category == "other":
            row.category = str(cat.get("category") or "other")
            changed = True
        if cat.get("vendor") and not row.vendor:
            row.vendor = cat["vendor"]
            changed = True
        if cat.get("product") and not row.product:
            row.product = cat["product"]
            changed = True
        if cat.get("detection_hint") and not row.detection_hint:
            row.detection_hint = cat["detection_hint"]
            changed = True
        if cat.get("tags") and not row.tags:
            row.tags = cat["tags"]
            changed = True
        if changed:
            updated += 1
    if updated:
        await session.flush()
    return added + updated


async def cve_stats(session: AsyncSession) -> dict[str, Any]:
    total = int((await session.execute(select(func.count()).select_from(CveEntry))).scalar_one())
    enabled = int(
        (await session.execute(select(func.count()).select_from(CveEntry).where(CveEntry.enabled.is_(True)))).scalar_one()
    )
    custom = int(
        (await session.execute(select(func.count()).select_from(CveEntry).where(CveEntry.is_custom.is_(True)))).scalar_one()
    )
    by_severity: dict[str, int] = {}
    for sev, cnt in (
        await session.execute(
            select(CveEntry.severity, func.count()).group_by(CveEntry.severity)
        )
    ).all():
        by_severity[str(sev)] = int(cnt)
    by_category: dict[str, int] = {}
    for cat, cnt in (
        await session.execute(
            select(CveEntry.category, func.count()).group_by(CveEntry.category)
        )
    ).all():
        by_category[str(cat)] = int(cnt)
    return {
        "total": total,
        "enabled": enabled,
        "custom": custom,
        "catalog_size": len(CVE_CATALOG),
        "by_category": {CVE_CATEGORIES.get(k, k): v for k, v in by_category.items()},
        "by_severity": by_severity,
        "categories": CVE_CATEGORIES,
    }


async def collect_referenced_cve_ids(session: AsyncSession) -> set[str]:
    ids = {str(c["cve_id"]).upper() for c in CVE_CATALOG}
    result = await session.execute(select(EnrichmentRule.cve_ids).where(EnrichmentRule.enabled.is_(True)))
    for row in result.scalars().all():
        if isinstance(row, list):
            for c in row:
                if c:
                    ids.add(str(c).upper())
    result2 = await session.execute(select(CveEntry.cve_id).where(CveEntry.enabled.is_(True)))
    for row in result2.scalars().all():
        ids.add(str(row).upper())
    return ids


async def fetch_osv_cve(cve_id: str) -> dict[str, Any] | None:
    url = f"https://api.osv.dev/v1/vulns/{cve_id.upper()}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return None
            data = resp.json()
    except Exception:
        log.debug("OSV fetch failed for %s", cve_id, exc_info=True)
        return None

    summary = cve_id
    if isinstance(data.get("summary"), str) and data["summary"].strip():
        summary = data["summary"][:2000]
    elif isinstance(data.get("details"), str) and data["details"].strip():
        summary = data["details"][:2000]

    severity = "unknown"
    score: float | None = None
    for sev in data.get("severity") or []:
        if isinstance(sev, dict) and sev.get("type") == "CVSS_V3":
            score_str = str(sev.get("score") or "")
            try:
                score = float(score_str.split("/")[0]) if "/" in score_str else float(score_str)
            except ValueError:
                pass
            if score is not None:
                if score >= 9.0:
                    severity = "critical"
                elif score >= 7.0:
                    severity = "high"
                elif score >= 4.0:
                    severity = "medium"
                else:
                    severity = "low"
            break

    refs = [str(r) for r in (data.get("references") or []) if r][:10]
    published = None
    if isinstance(data.get("published"), str):
        try:
            published = datetime.fromisoformat(data["published"].replace("Z", "+00:00"))
        except ValueError:
            published = None

    return {
        "cve_id": cve_id.upper(),
        "summary": summary,
        "severity": severity,
        "cvss_score": score,
        "published_at": published,
        "references": refs,
    }


async def sync_cve_cache(session: AsyncSession, *, fetch_remote: bool = True) -> tuple[int, str]:
    await ensure_catalog_cves(session)
    referenced = await collect_referenced_cve_ids(session)
    updated = 0
    now = datetime.now(UTC)

    for cve_id in sorted(referenced):
        r = await session.execute(select(CveEntry).where(CveEntry.cve_id == cve_id))
        existing = r.scalar_one_or_none()

        meta: dict[str, Any] | None = None
        if fetch_remote:
            meta = await fetch_osv_cve(cve_id)

        if meta is None:
            if existing is None:
                session.add(
                    CveEntry(
                        cve_id=cve_id,
                        summary=f"{cve_id} (tracked for honeypot correlation)",
                        severity="unknown",
                        category="other",
                        enabled=True,
                        is_custom=False,
                        synced_at=now,
                    )
                )
                updated += 1
            continue

        if existing is None:
            session.add(
                CveEntry(
                    cve_id=meta["cve_id"],
                    summary=meta["summary"],
                    severity=meta["severity"],
                    cvss_score=meta.get("cvss_score"),
                    published_at=meta.get("published_at"),
                    references=meta.get("references"),
                    category="other",
                    enabled=True,
                    is_custom=False,
                    synced_at=now,
                )
            )
            updated += 1
        else:
            if not existing.is_custom:
                existing.summary = meta["summary"]
                existing.severity = meta["severity"]
                existing.cvss_score = meta.get("cvss_score")
                existing.published_at = meta.get("published_at")
                existing.references = meta.get("references")
            existing.synced_at = now
            updated += 1

    await session.flush()
    total = int((await session.execute(select(func.count()).select_from(CveEntry))).scalar_one())
    msg = f"updated {updated}, cache size {total}"
    return updated, msg


async def lookup_cves(session: AsyncSession, cve_ids: list[str]) -> list[dict[str, Any]]:
    if not cve_ids:
        return []
    normalized = [c.upper() for c in cve_ids if _CVE_RE.match(str(c))]
    if not normalized:
        return []
    result = await session.execute(
        select(CveEntry).where(CveEntry.cve_id.in_(normalized), CveEntry.enabled.is_(True))
    )
    rows = result.scalars().all()
    return [
        {
            "cve_id": r.cve_id,
            "summary": r.summary,
            "severity": r.severity,
            "cvss_score": r.cvss_score,
            "category": r.category,
            "vendor": r.vendor,
            "product": r.product,
        }
        for r in rows
    ]
