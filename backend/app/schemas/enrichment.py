from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

PatternType = Literal["regex", "contains", "starts_with"]
MatchField = Literal["raw_log", "payload", "both"]
EnrichmentJobType = Literal["cve_sync", "batch_reenrich", "ip_scan"]


class EnrichmentConfigOut(BaseModel):
    enabled: bool = True
    auto_enrich_on_ingest: bool = True
    cve_lookup_enabled: bool = True
    elevate_severity: bool = True
    min_confidence: float = Field(default=0.3, ge=0.0, le=1.0)
    max_events_per_batch: int = Field(default=100, ge=1, le=1000)
    enrich_channels: list[str] = Field(default_factory=lambda: ["runtime"])
    skip_event_types: list[str] = Field(default_factory=list)
    ip_tracking_enabled: bool = True
    ip_lookup_enabled: bool = True
    ip_lookup_cooldown_hours: int = Field(default=24, ge=1, le=168)
    abuseipdb_api_key: str = ""
    version: int = 2


class EnrichmentConfigUpdate(BaseModel):
    enabled: bool | None = None
    auto_enrich_on_ingest: bool | None = None
    cve_lookup_enabled: bool | None = None
    elevate_severity: bool | None = None
    min_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    max_events_per_batch: int | None = Field(default=None, ge=1, le=1000)
    enrich_channels: list[str] | None = None
    skip_event_types: list[str] | None = None
    ip_tracking_enabled: bool | None = None
    ip_lookup_enabled: bool | None = None
    ip_lookup_cooldown_hours: int | None = Field(default=None, ge=1, le=168)
    abuseipdb_api_key: str | None = None


class EnrichmentRuleOut(BaseModel):
    id: UUID
    name: str
    description: str | None
    pattern: str
    pattern_type: str
    match_field: str
    attack_type: str | None
    tool: str | None
    technique: str | None
    cve_ids: list[str] | None
    severity: str | None
    enabled: bool
    priority: int
    is_builtin: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EnrichmentRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    pattern: str = Field(min_length=1, max_length=8000)
    pattern_type: PatternType = "regex"
    match_field: MatchField = "both"
    attack_type: str | None = Field(default=None, max_length=128)
    tool: str | None = Field(default=None, max_length=128)
    technique: str | None = Field(default=None, max_length=128)
    cve_ids: list[str] = Field(default_factory=list)
    severity: str | None = Field(default=None, max_length=32)
    enabled: bool = True
    priority: int = Field(default=50, ge=0, le=1000)


class EnrichmentRuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    pattern: str | None = Field(default=None, min_length=1, max_length=8000)
    pattern_type: PatternType | None = None
    match_field: MatchField | None = None
    attack_type: str | None = Field(default=None, max_length=128)
    tool: str | None = Field(default=None, max_length=128)
    technique: str | None = Field(default=None, max_length=128)
    cve_ids: list[str] | None = None
    severity: str | None = Field(default=None, max_length=32)
    enabled: bool | None = None
    priority: int | None = Field(default=None, ge=0, le=1000)


class EnrichmentScheduleOut(BaseModel):
    id: UUID
    name: str
    job_type: str
    interval_hours: int
    enabled: bool
    config: dict[str, Any] | None
    last_run_at: datetime | None
    next_run_at: datetime | None
    last_status: str | None
    last_message: str | None
    created_by_user_id: UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class EnrichmentScheduleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    job_type: EnrichmentJobType
    interval_hours: int = Field(default=24, ge=1, le=8760)
    enabled: bool = True
    config: dict[str, Any] | None = None


class EnrichmentScheduleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    job_type: EnrichmentJobType | None = None
    interval_hours: int | None = Field(default=None, ge=1, le=8760)
    enabled: bool | None = None
    config: dict[str, Any] | None = None


class CveEntryOut(BaseModel):
    cve_id: str
    summary: str
    severity: str
    cvss_score: float | None
    category: str
    vendor: str | None
    product: str | None
    tags: list[str] | None
    detection_hint: str | None
    enabled: bool
    is_custom: bool
    notes: str | None
    published_at: datetime | None
    references: list[str] | None
    synced_at: datetime

    model_config = {"from_attributes": True}


class CveEntryCreate(BaseModel):
    cve_id: str = Field(min_length=9, max_length=32, pattern=r"^CVE-\d{4}-\d+$")
    summary: str = Field(min_length=1, max_length=4000)
    severity: str = Field(default="unknown", max_length=32)
    cvss_score: float | None = Field(default=None, ge=0.0, le=10.0)
    category: str = Field(default="other", max_length=64)
    vendor: str | None = Field(default=None, max_length=128)
    product: str | None = Field(default=None, max_length=128)
    tags: list[str] = Field(default_factory=list)
    detection_hint: str | None = Field(default=None, max_length=2000)
    enabled: bool = True
    notes: str | None = Field(default=None, max_length=4000)
    references: list[str] = Field(default_factory=list)


class CveEntryUpdate(BaseModel):
    summary: str | None = Field(default=None, min_length=1, max_length=4000)
    severity: str | None = Field(default=None, max_length=32)
    cvss_score: float | None = Field(default=None, ge=0.0, le=10.0)
    category: str | None = Field(default=None, max_length=64)
    vendor: str | None = Field(default=None, max_length=128)
    product: str | None = Field(default=None, max_length=128)
    tags: list[str] | None = None
    detection_hint: str | None = Field(default=None, max_length=2000)
    enabled: bool | None = None
    notes: str | None = Field(default=None, max_length=4000)
    references: list[str] | None = None


class CveBulkCreate(BaseModel):
    cve_ids: list[str] = Field(min_length=1, max_length=200)
    fetch_remote: bool = True


class CveStatsOut(BaseModel):
    total: int
    enabled: int
    custom: int
    catalog_size: int
    by_category: dict[str, int]
    by_severity: dict[str, int]
    categories: dict[str, str]


class ThreatIpOut(BaseModel):
    id: UUID
    ip_address: str
    status: str
    hit_count: int
    match_count: int
    pot_ids: list[str] | None
    attack_types: list[str] | None
    cve_ids: list[str] | None
    tools: list[str] | None
    tags: list[str] | None
    user_notes: str | None
    geo: dict[str, Any] | None
    abuse_score: int | None
    is_tor: bool | None
    is_hosting: bool | None
    lookup_status: str | None
    last_lookup_at: datetime | None
    first_seen_at: datetime
    last_seen_at: datetime

    model_config = {"from_attributes": True}


class ThreatIpUpdate(BaseModel):
    status: Literal["observed", "suspicious", "watchlist", "allowlisted"] | None = None
    user_notes: str | None = Field(default=None, max_length=4000)
    tags: list[str] | None = None


class IpScanRequest(BaseModel):
    lookback_hours: int = Field(default=168, ge=1, le=720)
    limit: int = Field(default=500, ge=1, le=5000)


class IpIntelStatsOut(BaseModel):
    total: int
    suspicious: int
    watchlist: int
    with_geo: int
    top_countries: list[dict[str, Any]]
    recent: list[dict[str, Any]]


class EnrichmentStatsOut(BaseModel):
    range: str
    since: str
    until: str
    total_events: int
    enriched_events: int
    matched_events: int
    enrichment_rate: float
    by_attack_type: list[dict[str, Any]]
    by_tool: list[dict[str, Any]]
    by_cve: list[dict[str, Any]]
    recent_matches: list[dict[str, Any]]
    rules_total: int
    rules_enabled: int
    cve_cache_size: int
    schedules_enabled: int
    config: EnrichmentConfigOut


class ReprocessRequest(BaseModel):
    lookback_hours: int = Field(default=24, ge=1, le=168)
    limit: int = Field(default=200, ge=1, le=2000)
    pot_id: UUID | None = None
    force: bool = Field(default=False, description="Re-enrich even if already matched")


class RuleTestRequest(BaseModel):
    sample_text: str = Field(min_length=1, max_length=50000)


class RuleTestResult(BaseModel):
    matched: bool
    matches: list[dict[str, Any]]
