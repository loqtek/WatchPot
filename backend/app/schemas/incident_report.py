"""Structured incident report used for honeypot writeups."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

ReportFocus = Literal["activity", "threats", "commands", "stream"]
ReportRange = Literal["1h", "1d", "7d", "14d", "30d", "90d", "all"]


class IncidentReportRequest(BaseModel):
    title: str = Field(default="Honeypot activity report", max_length=200)
    range: ReportRange | None = "7d"
    since: datetime | None = None
    until: datetime | None = None
    pot_id: UUID | None = None
    src_ip: str | None = Field(default=None, max_length=64)
    focus: ReportFocus = "activity"
    analyst_notes: str = Field(default="", max_length=20000)
    include_raw: bool = True
    limit: int = Field(default=200, ge=1, le=400)


class ReportScope(BaseModel):
    title: str
    focus: str
    focus_label: str
    range_key: str
    since: datetime
    until: datetime
    pot_id: str | None = None
    pot_name: str | None = None
    src_ip: str | None = None
    include_raw: bool
    analyst_notes: str = ""
    generated_at: datetime
    generated_by: str
    events_truncated: bool = False
    commands_truncated: bool = False
    scan_capped: bool = False
    truncation_notes: list[str] = Field(default_factory=list)


class ReportCounts(BaseModel):
    events: int = 0
    matched_events: int = 0
    commands: int = 0
    shell: int = 0
    http: int = 0
    login: int = 0
    download: int = 0
    other_commands: int = 0
    source_ips: int = 0
    usernames: int = 0
    cves: int = 0
    pots: int = 0
    sessions: int = 0
    services: int = 0


class ReportPot(BaseModel):
    id: str
    name: str
    description: str | None = None
    last_ip: str | None = None
    event_count: int = 0
    command_count: int = 0


class ReportGeo(BaseModel):
    model_config = {"extra": "ignore"}

    country: str | None = None
    country_code: str | None = None
    region: str | None = None
    city: str | None = None
    isp: str | None = None
    org: str | None = None
    asn: int | None = None
    asn_label: str | None = None
    is_hosting: bool | None = None
    is_proxy: bool | None = None


class ReportAttacker(BaseModel):
    ip_address: str
    status: str
    tracked: bool = False
    hit_count: int | None = None
    match_count: int | None = None
    abuse_score: int | None = None
    is_tor: bool | None = None
    is_hosting: bool | None = None
    geo: ReportGeo | None = None
    attack_types: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    cve_ids: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    user_notes: str | None = None
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    command_count: int = 0
    event_count: int = 0
    usernames: list[str] = Field(default_factory=list)


class CountItem(BaseModel):
    key: str
    label: str
    count: int


class ReportCveDetail(BaseModel):
    cve_id: str
    summary: str | None = None
    severity: str | None = None
    cvss_score: float | None = None


class ReportEvent(BaseModel):
    id: str
    received_at: datetime
    pot_id: str
    pot_name: str | None = None
    stack_id: str | None = None
    stack_name: str | None = None
    service_name: str | None = None
    event_type: str
    event_title: str
    summary: str | None = None
    severity: str
    channel: str
    source: str
    source_ips: list[str] = Field(default_factory=list)
    attack_types: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    techniques: list[str] = Field(default_factory=list)
    cve_ids: list[str] = Field(default_factory=list)
    rule_names: list[str] = Field(default_factory=list)
    confidence: float | None = None
    enrichment_status: str | None = None
    cve_details: list[ReportCveDetail] = Field(default_factory=list)
    payload: dict | None = None
    payload_truncated: bool = False
    raw_log: str | None = None
    raw_log_truncated: bool = False


class ReportCommand(BaseModel):
    id: str
    pot_id: str
    pot_name: str | None = None
    container: str | None = None
    kind: str
    command: str
    src_ip: str | None = None
    session_id: str | None = None
    username: str | None = None
    hit_count: int
    observed_at: datetime
    first_seen_at: datetime
    last_seen_at: datetime
    event_id: str | None = None
    context: str | None = None
    context_truncated: bool = False


class ReportCve(BaseModel):
    cve_id: str
    summary: str | None = None
    severity: str | None = None
    cvss_score: float | None = None
    category: str | None = None
    vendor: str | None = None
    product: str | None = None
    references: list[str] = Field(default_factory=list)
    notes: str | None = None
    event_count: int = 0
    source_ips: list[str] = Field(default_factory=list)
    in_cache: bool = False


class IncidentReport(BaseModel):
    scope: ReportScope
    paragraphs: list[str]
    counts: ReportCounts
    pots: list[ReportPot]
    services: list[str]
    attackers: list[ReportAttacker]
    by_attack_type: list[CountItem]
    by_tool: list[CountItem]
    by_severity: list[CountItem]
    by_technique: list[CountItem]
    usernames: list[str]
    timeline: list[ReportEvent]
    commands: list[ReportCommand]
    cves: list[ReportCve]
