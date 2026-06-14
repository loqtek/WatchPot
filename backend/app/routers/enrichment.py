from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit_service import write_audit
from app.database import get_db
from app.deps import get_current_user
from app.enrichment.bootstrap import ensure_builtin_rules, ensure_default_schedules
from app.enrichment.config import load_config, save_config
from app.enrichment.cve import cve_stats, ensure_catalog_cves, seed_cve_cache, sync_cve_cache
from app.enrichment.ip_intel import ip_intel_stats, lookup_ip_geo, scan_events_for_ips
from app.enrichment.engine import test_sample
from app.enrichment.scheduler import run_schedule, schedule_next_run
from app.enrichment.worker import batch_reenrich
from app.models.cve_entry import CveEntry
from app.models.enrichment_rule import EnrichmentRule
from app.models.enrichment_schedule import EnrichmentSchedule
from app.models.threat_ip import ThreatIp
from app.models.user import User
from app.schemas.enrichment import (
    CveBulkCreate,
    CveEntryCreate,
    CveEntryOut,
    CveEntryUpdate,
    CveStatsOut,
    EnrichmentConfigOut,
    EnrichmentConfigUpdate,
    EnrichmentRuleCreate,
    EnrichmentRuleOut,
    EnrichmentRuleUpdate,
    EnrichmentScheduleCreate,
    EnrichmentScheduleOut,
    EnrichmentScheduleUpdate,
    EnrichmentStatsOut,
    IpIntelStatsOut,
    IpScanRequest,
    ReprocessRequest,
    RuleTestRequest,
    RuleTestResult,
    ThreatIpOut,
    ThreatIpUpdate,
)
from app.services.enrichment_analytics import enrichment_stats

router = APIRouter(prefix="/enrichment", tags=["enrichment"])


@router.get("/config", response_model=EnrichmentConfigOut)
async def get_config(
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EnrichmentConfigOut:
    cfg = await load_config(db)
    return EnrichmentConfigOut.model_validate(cfg)


@router.put("/config", response_model=EnrichmentConfigOut)
async def update_config(
    request: Request,
    body: EnrichmentConfigUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EnrichmentConfigOut:
    current = await load_config(db)
    patch = body.model_dump(exclude_unset=True)
    current.update(patch)
    saved = await save_config(db, current)
    await write_audit(
        db,
        action="enrichment.config.update",
        actor_user_id=user.id,
        resource_type="enrichment_config",
        detail=patch,
        ip_address=request.client.host if request.client else None,
    )
    return EnrichmentConfigOut.model_validate(saved)


@router.get("/stats", response_model=EnrichmentStatsOut)
async def get_stats(
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    range_key: str = Query("1d", alias="range"),
    pot_id: UUID | None = None,
) -> EnrichmentStatsOut:
    data = await enrichment_stats(db, range_key=range_key, pot_id=pot_id)
    return EnrichmentStatsOut.model_validate(data)


@router.get("/rules", response_model=list[EnrichmentRuleOut])
async def list_rules(
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    enabled_only: bool = False,
) -> list[EnrichmentRuleOut]:
    q = select(EnrichmentRule).order_by(EnrichmentRule.priority.desc(), EnrichmentRule.name.asc())
    if enabled_only:
        q = q.where(EnrichmentRule.enabled.is_(True))
    result = await db.execute(q)
    return [EnrichmentRuleOut.model_validate(r) for r in result.scalars().all()]


@router.post("/rules", response_model=EnrichmentRuleOut, status_code=status.HTTP_201_CREATED)
async def create_rule(
    request: Request,
    body: EnrichmentRuleCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EnrichmentRuleOut:
    rule = EnrichmentRule(
        name=body.name.strip(),
        description=body.description,
        pattern=body.pattern,
        pattern_type=body.pattern_type,
        match_field=body.match_field,
        attack_type=body.attack_type,
        tool=body.tool,
        technique=body.technique,
        cve_ids=body.cve_ids,
        severity=body.severity,
        enabled=body.enabled,
        priority=body.priority,
        is_builtin=False,
    )
    db.add(rule)
    await db.flush()
    await write_audit(
        db,
        action="enrichment.rule.create",
        actor_user_id=user.id,
        resource_type="enrichment_rule",
        resource_id=str(rule.id),
        detail={"name": rule.name},
        ip_address=request.client.host if request.client else None,
    )
    return EnrichmentRuleOut.model_validate(rule)


@router.patch("/rules/{rule_id}", response_model=EnrichmentRuleOut)
async def update_rule(
    rule_id: UUID,
    request: Request,
    body: EnrichmentRuleUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EnrichmentRuleOut:
    result = await db.execute(select(EnrichmentRule).where(EnrichmentRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    patch = body.model_dump(exclude_unset=True)
    for key, value in patch.items():
        setattr(rule, key, value)
    rule.updated_at = datetime.now(UTC)
    await write_audit(
        db,
        action="enrichment.rule.update",
        actor_user_id=user.id,
        resource_type="enrichment_rule",
        resource_id=str(rule.id),
        detail=patch,
        ip_address=request.client.host if request.client else None,
    )
    return EnrichmentRuleOut.model_validate(rule)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(
    rule_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    result = await db.execute(select(EnrichmentRule).where(EnrichmentRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    if rule.is_builtin:
        raise HTTPException(status_code=400, detail="Built-in rules cannot be deleted; disable instead")
    await db.delete(rule)
    await write_audit(
        db,
        action="enrichment.rule.delete",
        actor_user_id=user.id,
        resource_type="enrichment_rule",
        resource_id=str(rule_id),
        detail={"name": rule.name},
        ip_address=request.client.host if request.client else None,
    )


@router.post("/rules/test", response_model=RuleTestResult)
async def test_rules(
    body: RuleTestRequest,
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RuleTestResult:
    result = await db.execute(
        select(EnrichmentRule).where(EnrichmentRule.enabled.is_(True)).order_by(EnrichmentRule.priority.desc())
    )
    rules = list(result.scalars().all())
    matches = test_sample(rules, body.sample_text)
    return RuleTestResult(matched=bool(matches), matches=matches)


@router.get("/schedules", response_model=list[EnrichmentScheduleOut])
async def list_schedules(
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[EnrichmentScheduleOut]:
    result = await db.execute(select(EnrichmentSchedule).order_by(EnrichmentSchedule.created_at.desc()))
    return [EnrichmentScheduleOut.model_validate(s) for s in result.scalars().all()]


@router.post("/schedules", response_model=EnrichmentScheduleOut, status_code=status.HTTP_201_CREATED)
async def create_schedule(
    request: Request,
    body: EnrichmentScheduleCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EnrichmentScheduleOut:
    now = datetime.now(UTC)
    sched = EnrichmentSchedule(
        name=body.name.strip(),
        job_type=body.job_type,
        interval_hours=body.interval_hours,
        enabled=body.enabled,
        config=body.config,
        created_by_user_id=user.id,
        next_run_at=now,
    )
    sched.next_run_at = schedule_next_run(sched, from_time=now)
    db.add(sched)
    await db.flush()
    await write_audit(
        db,
        action="enrichment.schedule.create",
        actor_user_id=user.id,
        resource_type="enrichment_schedule",
        resource_id=str(sched.id),
        detail={"name": sched.name, "job_type": sched.job_type},
        ip_address=request.client.host if request.client else None,
    )
    return EnrichmentScheduleOut.model_validate(sched)


@router.patch("/schedules/{schedule_id}", response_model=EnrichmentScheduleOut)
async def update_schedule(
    schedule_id: UUID,
    request: Request,
    body: EnrichmentScheduleUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EnrichmentScheduleOut:
    result = await db.execute(select(EnrichmentSchedule).where(EnrichmentSchedule.id == schedule_id))
    sched = result.scalar_one_or_none()
    if sched is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    patch = body.model_dump(exclude_unset=True)
    for key, value in patch.items():
        setattr(sched, key, value)
    if "interval_hours" in patch and sched.next_run_at:
        sched.next_run_at = schedule_next_run(sched)
    await write_audit(
        db,
        action="enrichment.schedule.update",
        actor_user_id=user.id,
        resource_type="enrichment_schedule",
        resource_id=str(sched.id),
        detail=patch,
        ip_address=request.client.host if request.client else None,
    )
    return EnrichmentScheduleOut.model_validate(sched)


@router.delete("/schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule(
    schedule_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    result = await db.execute(select(EnrichmentSchedule).where(EnrichmentSchedule.id == schedule_id))
    sched = result.scalar_one_or_none()
    if sched is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    await db.delete(sched)
    await write_audit(
        db,
        action="enrichment.schedule.delete",
        actor_user_id=user.id,
        resource_type="enrichment_schedule",
        resource_id=str(schedule_id),
        ip_address=request.client.host if request.client else None,
    )


@router.post("/schedules/{schedule_id}/run")
async def run_schedule_now(
    schedule_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    result = await db.execute(select(EnrichmentSchedule).where(EnrichmentSchedule.id == schedule_id))
    sched = result.scalar_one_or_none()
    if sched is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    msg = await run_schedule(db, sched)
    await write_audit(
        db,
        action="enrichment.schedule.run",
        actor_user_id=user.id,
        resource_type="enrichment_schedule",
        resource_id=str(sched.id),
        detail={"message": msg},
        ip_address=request.client.host if request.client else None,
    )
    return {"ok": True, "message": msg, "last_status": sched.last_status}


@router.get("/cve/stats", response_model=CveStatsOut)
async def get_cve_stats(
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CveStatsOut:
    return CveStatsOut.model_validate(await cve_stats(db))


@router.get("/cve", response_model=list[CveEntryOut])
async def list_cves(
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    q: str | None = Query(default=None, description="Search CVE id, vendor, product, or summary"),
    category: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    enabled_only: bool = Query(default=False),
    custom_only: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[CveEntryOut]:
    stmt = select(CveEntry).order_by(CveEntry.cvss_score.desc().nullslast(), CveEntry.cve_id.asc()).limit(limit).offset(offset)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            (CveEntry.cve_id.ilike(like))
            | (CveEntry.summary.ilike(like))
            | (CveEntry.vendor.ilike(like))
            | (CveEntry.product.ilike(like))
        )
    if category:
        stmt = stmt.where(CveEntry.category == category.strip())
    if severity:
        stmt = stmt.where(CveEntry.severity == severity.strip().lower())
    if enabled_only:
        stmt = stmt.where(CveEntry.enabled.is_(True))
    if custom_only:
        stmt = stmt.where(CveEntry.is_custom.is_(True))
    result = await db.execute(stmt)
    return [CveEntryOut.model_validate(r) for r in result.scalars().all()]


@router.get("/cve/{cve_id}", response_model=CveEntryOut)
async def get_cve(
    cve_id: str,
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CveEntryOut:
    cid = cve_id.strip().upper()
    result = await db.execute(select(CveEntry).where(CveEntry.cve_id == cid))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="CVE not found")
    return CveEntryOut.model_validate(row)


@router.post("/cve", response_model=CveEntryOut, status_code=status.HTTP_201_CREATED)
async def create_cve(
    request: Request,
    body: CveEntryCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CveEntryOut:
    cid = body.cve_id.strip().upper()
    existing = await db.execute(select(CveEntry).where(CveEntry.cve_id == cid))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="CVE already exists")
    row = CveEntry(
        cve_id=cid,
        summary=body.summary,
        severity=body.severity.lower(),
        cvss_score=body.cvss_score,
        category=body.category,
        vendor=body.vendor,
        product=body.product,
        tags=body.tags,
        detection_hint=body.detection_hint,
        enabled=body.enabled,
        is_custom=True,
        notes=body.notes,
        references=body.references or [f"https://nvd.nist.gov/vuln/detail/{cid}"],
    )
    db.add(row)
    await db.flush()
    await write_audit(
        db,
        action="enrichment.cve.create",
        actor_user_id=user.id,
        resource_type="cve_entry",
        resource_id=cid,
        ip_address=request.client.host if request.client else None,
    )
    return CveEntryOut.model_validate(row)


@router.post("/cve/bulk")
async def bulk_add_cves(
    request: Request,
    body: CveBulkCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    from app.enrichment.cve import fetch_osv_cve

    added = 0
    for raw in body.cve_ids:
        cid = raw.strip().upper()
        if not cid.startswith("CVE-"):
            continue
        r = await db.execute(select(CveEntry).where(CveEntry.cve_id == cid))
        if r.scalar_one_or_none() is not None:
            continue
        meta = await fetch_osv_cve(cid) if body.fetch_remote else None
        if meta:
            db.add(
                CveEntry(
                    cve_id=cid,
                    summary=meta["summary"],
                    severity=meta["severity"],
                    cvss_score=meta.get("cvss_score"),
                    published_at=meta.get("published_at"),
                    references=meta.get("references"),
                    category="other",
                    is_custom=True,
                    enabled=True,
                )
            )
        else:
            db.add(
                CveEntry(
                    cve_id=cid,
                    summary=f"{cid} (operator-added)",
                    severity="unknown",
                    category="other",
                    is_custom=True,
                    enabled=True,
                )
            )
        added += 1
    await write_audit(
        db,
        action="enrichment.cve.bulk",
        actor_user_id=user.id,
        detail={"added": added},
        ip_address=request.client.host if request.client else None,
    )
    return {"ok": True, "added": added}


@router.patch("/cve/{cve_id}", response_model=CveEntryOut)
async def update_cve(
    cve_id: str,
    request: Request,
    body: CveEntryUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CveEntryOut:
    cid = cve_id.strip().upper()
    result = await db.execute(select(CveEntry).where(CveEntry.cve_id == cid))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="CVE not found")
    patch = body.model_dump(exclude_unset=True)
    for key, value in patch.items():
        setattr(row, key, value)
    await write_audit(
        db,
        action="enrichment.cve.update",
        actor_user_id=user.id,
        resource_type="cve_entry",
        resource_id=cid,
        detail=patch,
        ip_address=request.client.host if request.client else None,
    )
    return CveEntryOut.model_validate(row)


@router.delete("/cve/{cve_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_cve(
    cve_id: str,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    cid = cve_id.strip().upper()
    result = await db.execute(select(CveEntry).where(CveEntry.cve_id == cid))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="CVE not found")
    if not row.is_custom:
        raise HTTPException(status_code=400, detail="Catalog CVEs cannot be deleted; disable instead")
    await db.delete(row)
    await write_audit(
        db,
        action="enrichment.cve.delete",
        actor_user_id=user.id,
        resource_type="cve_entry",
        resource_id=cid,
        ip_address=request.client.host if request.client else None,
    )


@router.post("/cve/catalog/refresh")
async def refresh_catalog(
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    n = await ensure_catalog_cves(db)
    await write_audit(
        db,
        action="enrichment.cve.catalog_refresh",
        actor_user_id=user.id,
        ip_address=request.client.host if request.client else None,
    )
    total = int((await db.execute(select(func.count()).select_from(CveEntry))).scalar_one())
    return {"ok": True, "updated": n, "cache_size": total}


@router.post("/cve/sync")
async def sync_cves(
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    fetch_remote: bool = Query(default=True),
) -> dict:
    updated, msg = await sync_cve_cache(db, fetch_remote=fetch_remote)
    await write_audit(
        db,
        action="enrichment.cve.sync",
        actor_user_id=user.id,
        resource_type="cve_cache",
        detail={"updated": updated, "message": msg},
        ip_address=request.client.host if request.client else None,
    )
    total = int((await db.execute(select(func.count()).select_from(CveEntry))).scalar_one())
    return {"ok": True, "updated": updated, "cache_size": total, "message": msg}


@router.post("/reprocess")
async def reprocess_events(
    request: Request,
    body: ReprocessRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    processed, matched = await batch_reenrich(
        db,
        lookback_hours=body.lookback_hours,
        limit=body.limit,
        pot_id=body.pot_id,
        force=body.force,
    )
    await write_audit(
        db,
        action="enrichment.reprocess",
        actor_user_id=user.id,
        detail={
            "lookback_hours": body.lookback_hours,
            "limit": body.limit,
            "processed": processed,
            "matched": matched,
        },
        ip_address=request.client.host if request.client else None,
    )
    return {"ok": True, "processed": processed, "matched": matched}


@router.get("/ips/stats", response_model=IpIntelStatsOut)
async def get_ip_stats(
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> IpIntelStatsOut:
    return IpIntelStatsOut.model_validate(await ip_intel_stats(db))


@router.get("/ips", response_model=list[ThreatIpOut])
async def list_ips(
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    q: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[ThreatIpOut]:
    stmt = select(ThreatIp).order_by(ThreatIp.last_seen_at.desc()).limit(limit).offset(offset)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            (ThreatIp.ip_address.ilike(like))
            | (ThreatIp.user_notes.ilike(like))
        )
    if status:
        stmt = stmt.where(ThreatIp.status == status.strip().lower())
    result = await db.execute(stmt)
    return [ThreatIpOut.model_validate(r) for r in result.scalars().all()]


@router.get("/ips/{ip_address}", response_model=ThreatIpOut)
async def get_ip(
    ip_address: str,
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ThreatIpOut:
    result = await db.execute(select(ThreatIp).where(ThreatIp.ip_address == ip_address.strip()))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="IP not tracked")
    return ThreatIpOut.model_validate(row)


@router.patch("/ips/{ip_address}", response_model=ThreatIpOut)
async def update_ip(
    ip_address: str,
    request: Request,
    body: ThreatIpUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ThreatIpOut:
    result = await db.execute(select(ThreatIp).where(ThreatIp.ip_address == ip_address.strip()))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="IP not tracked")
    patch = body.model_dump(exclude_unset=True)
    for key, value in patch.items():
        setattr(row, key, value)
    await write_audit(
        db,
        action="enrichment.ip.update",
        actor_user_id=user.id,
        resource_type="threat_ip",
        resource_id=row.ip_address,
        detail=patch,
        ip_address=request.client.host if request.client else None,
    )
    return ThreatIpOut.model_validate(row)


@router.post("/ips/{ip_address}/lookup", response_model=ThreatIpOut)
async def lookup_ip(
    ip_address: str,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ThreatIpOut:
    from datetime import UTC, datetime

    ip = ip_address.strip()
    result = await db.execute(select(ThreatIp).where(ThreatIp.ip_address == ip))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="IP not tracked yet — run IP scan first")
    cfg = await load_config(db)
    geo = await lookup_ip_geo(ip)
    now = datetime.now(UTC)
    if geo.get("ok"):
        row.geo = {k: geo[k] for k in geo if k not in ("ok", "error")}
        row.is_hosting = geo.get("is_hosting")
        row.lookup_status = "ok"
    else:
        row.lookup_status = "failed"
    row.last_lookup_at = now
    abuse_key = str(cfg.get("abuseipdb_api_key") or "").strip()
    if abuse_key:
        from app.enrichment.ip_intel import lookup_ip_abuseipdb

        abuse = await lookup_ip_abuseipdb(ip, abuse_key)
        if abuse.get("ok"):
            row.abuse_score = abuse.get("abuse_score")
            row.is_tor = abuse.get("is_tor")
    await write_audit(
        db,
        action="enrichment.ip.lookup",
        actor_user_id=user.id,
        resource_type="threat_ip",
        resource_id=ip,
        ip_address=request.client.host if request.client else None,
    )
    return ThreatIpOut.model_validate(row)


@router.post("/ips/scan")
async def scan_ips(
    request: Request,
    body: IpScanRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    events, ips = await scan_events_for_ips(db, lookback_hours=body.lookback_hours, limit=body.limit)
    await write_audit(
        db,
        action="enrichment.ip.scan",
        actor_user_id=user.id,
        detail={"events": events, "ips_found": ips},
        ip_address=request.client.host if request.client else None,
    )
    total = int((await db.execute(select(func.count()).select_from(ThreatIp))).scalar_one())
    return {"ok": True, "events_scanned": events, "ips_found": ips, "total_tracked": total}


@router.post("/bootstrap/seed")
async def seed_defaults(
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Idempotent seed of built-in rules, schedules, and CVE cache."""
    rules = await ensure_builtin_rules(db)
    schedules = await ensure_default_schedules(db)
    cves = await ensure_catalog_cves(db)
    await write_audit(
        db,
        action="enrichment.bootstrap.seed",
        actor_user_id=user.id,
        ip_address=request.client.host if request.client else None,
    )
    return {"rules_added": rules, "schedules_added": schedules, "cves_added": cves}
