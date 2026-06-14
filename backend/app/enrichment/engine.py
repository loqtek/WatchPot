"""Passive fingerprint engine — rule matching against event text."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from app.models.enrichment_rule import EnrichmentRule

_SEVERITY_RANK = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4, "warning": 2, "error": 3}


@dataclass
class RuleMatch:
    rule_id: str
    rule_name: str
    attack_type: str | None
    tool: str | None
    technique: str | None
    cve_ids: list[str] = field(default_factory=list)
    severity: str | None = None


def _build_match_text(
    *,
    raw_log: str | None,
    payload: dict | None,
    match_field: str,
) -> str:
    parts: list[str] = []
    if match_field in ("raw_log", "both") and raw_log:
        parts.append(raw_log)
    if match_field in ("payload", "both") and payload:
        try:
            parts.append(json.dumps(payload, default=str))
        except (TypeError, ValueError):
            parts.append(str(payload))
    return "\n".join(parts)


def _pattern_matches(pattern: str, pattern_type: str, text: str) -> bool:
    if not pattern or not text:
        return False
    if pattern_type == "contains":
        return pattern.lower() in text.lower()
    if pattern_type == "starts_with":
        return text.lower().startswith(pattern.lower())
    try:
        return re.search(pattern, text, re.MULTILINE | re.DOTALL) is not None
    except re.error:
        return False


def match_rules(
    rules: list[EnrichmentRule],
    *,
    raw_log: str | None,
    payload: dict | None,
) -> list[RuleMatch]:
    matches: list[RuleMatch] = []
    for rule in rules:
        if not rule.enabled:
            continue
        text = _build_match_text(raw_log=raw_log, payload=payload, match_field=rule.match_field)
        if not text:
            continue
        if _pattern_matches(rule.pattern, rule.pattern_type, text):
            cve_ids = [str(c) for c in (rule.cve_ids or []) if c]
            matches.append(
                RuleMatch(
                    rule_id=str(rule.id),
                    rule_name=rule.name,
                    attack_type=rule.attack_type,
                    tool=rule.tool,
                    technique=rule.technique,
                    cve_ids=cve_ids,
                    severity=rule.severity,
                )
            )
    return matches


def aggregate_matches(matches: list[RuleMatch]) -> dict[str, Any]:
    if not matches:
        return {
            "status": "none",
            "attack_types": [],
            "tools": [],
            "techniques": [],
            "cve_ids": [],
            "rules_matched": [],
            "confidence": 0.0,
            "max_severity": None,
        }

    attack_types = sorted({m.attack_type for m in matches if m.attack_type})
    tools = sorted({m.tool for m in matches if m.tool})
    techniques = sorted({m.technique for m in matches if m.technique})
    cve_ids = sorted({c for m in matches for c in m.cve_ids})
    rules_matched = [m.rule_id for m in matches]

    confidence = min(1.0, 0.35 + 0.15 * len(matches))
    if cve_ids:
        confidence = min(1.0, confidence + 0.1)

    max_sev: str | None = None
    max_rank = -1
    for m in matches:
        if m.severity:
            rank = _SEVERITY_RANK.get(m.severity.lower(), 0)
            if rank > max_rank:
                max_rank = rank
                max_sev = m.severity.lower()

    return {
        "status": "matched",
        "attack_types": attack_types,
        "tools": tools,
        "techniques": techniques,
        "cve_ids": cve_ids,
        "rules_matched": rules_matched,
        "rule_names": [m.rule_name for m in matches],
        "confidence": round(confidence, 2),
        "max_severity": max_sev,
    }


def test_sample(rules: list[EnrichmentRule], sample_text: str) -> list[dict[str, Any]]:
    matches = match_rules(rules, raw_log=sample_text, payload=None)
    return [
        {
            "rule_id": m.rule_id,
            "rule_name": m.rule_name,
            "attack_type": m.attack_type,
            "tool": m.tool,
            "technique": m.technique,
            "cve_ids": m.cve_ids,
            "severity": m.severity,
        }
        for m in matches
    ]
