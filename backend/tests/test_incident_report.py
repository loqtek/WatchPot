"""Incident report selection, redaction, and export rendering."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.schemas.incident_report import (
    IncidentReport,
    ReportCommand,
    ReportCounts,
    ReportEvent,
    ReportScope,
)
from app.services.incident_report import (
    ReportError,
    event_source_ips,
    include_event,
    prepare_payload,
    redact_text,
    resolve_window,
    write_paragraphs,
)
from app.services.incident_report_format import report_filename
from app.services.incident_report_html import render_html
from app.services.incident_report_markdown import render_markdown


def _scope(**overrides) -> ReportScope:
    now = datetime(2026, 10, 12, 15, 0, tzinfo=UTC)
    base = dict(
        title="Edge pot intrusion",
        focus="activity",
        focus_label="Incident writeup",
        range_key="7d",
        since=now - timedelta(days=7),
        until=now,
        include_raw=True,
        analyst_notes="Looks like a Cowrie session followed by a fetch.",
        generated_at=now,
        generated_by="wpadmin",
    )
    base.update(overrides)
    return ReportScope(**base)


def _report() -> IncidentReport:
    when = datetime(2026, 10, 12, 12, 0, tzinfo=UTC)
    event = ReportEvent(
        id="11111111-1111-1111-1111-111111111111",
        received_at=when,
        pot_id="22222222-2222-2222-2222-222222222222",
        pot_name="edge-01",
        event_type="watchpot.agent.container_logs",
        event_title="Container logs",
        summary="cowrie",
        severity="high",
        channel="runtime",
        source="agent",
        source_ips=["203.0.113.10"],
        attack_types=["brute_force"],
        tools=["cowrie"],
        enrichment_status="matched",
        payload={"container": "cowrie", "password": "***"},
        raw_log="CMD: uname -a\n<script>alert(1)</script>",
    )
    command = ReportCommand(
        id="33333333-3333-3333-3333-333333333333",
        pot_id=event.pot_id,
        pot_name="edge-01",
        container="cowrie",
        kind="shell",
        command="uname -a && <script>alert(1)</script>",
        src_ip="203.0.113.10",
        session_id="s1",
        username="root",
        hit_count=2,
        observed_at=when,
        first_seen_at=when,
        last_seen_at=when,
        event_id=event.id,
        context="CMD: uname -a",
    )
    scope = _scope()
    counts = ReportCounts(events=1, matched_events=1, commands=1, shell=1, source_ips=1, pots=1, sessions=1, services=1)
    report = IncidentReport(
        scope=scope,
        paragraphs=[],
        counts=counts,
        pots=[],
        services=["cowrie"],
        attackers=[],
        by_attack_type=[],
        by_tool=[],
        by_severity=[],
        by_technique=[],
        usernames=["root"],
        timeline=[event],
        commands=[command],
        cves=[],
    )
    report.paragraphs = write_paragraphs(scope, counts, [], [], [], [])
    return report


def test_resolve_window_rejects_inverted_and_overlong_ranges() -> None:
    start = datetime(2026, 10, 12, tzinfo=UTC)
    with pytest.raises(ReportError):
        resolve_window(None, start, start)
    with pytest.raises(ReportError):
        resolve_window(None, start, start - timedelta(hours=1))
    with pytest.raises(ReportError):
        resolve_window(None, start, start + timedelta(days=400))
    with pytest.raises(ReportError):
        resolve_window(None, start, None)


def test_resolve_window_custom_and_presets() -> None:
    start = datetime(2026, 10, 1, tzinfo=UTC)
    end = datetime(2026, 10, 8, tzinfo=UTC)
    resolved_start, resolved_end, key = resolve_window(None, start, end)
    assert key == "custom"
    assert resolved_start == start
    assert resolved_end == end
    _, _, ninety = resolve_window("90d", None, None)
    assert ninety == "90d"
    _, _, everything = resolve_window("all", None, None)
    assert everything == "all"


def test_include_event_keeps_matches_and_command_evidence() -> None:
    linked = {"evt-1"}
    assert include_event(
        focus="activity",
        channel="runtime",
        event_type="watchpot.agent.container_logs",
        event_id="evt-2",
        matched=True,
        source_ips=set(),
        command_event_ids=linked,
        src_ip=None,
    )
    assert include_event(
        focus="activity",
        channel="runtime",
        event_type="watchpot.agent.container_logs",
        event_id="evt-1",
        matched=False,
        source_ips=set(),
        command_event_ids=linked,
        src_ip=None,
    )
    assert not include_event(
        focus="activity",
        channel="runtime",
        event_type="watchpot.agent.container_logs",
        event_id="evt-3",
        matched=False,
        source_ips={"203.0.113.10"},
        command_event_ids=linked,
        src_ip=None,
    )
    assert not include_event(
        focus="activity",
        channel="runtime",
        event_type="watchpot.agent.infra_snapshot",
        event_id="evt-4",
        matched=False,
        source_ips=set(),
        command_event_ids=set(),
        src_ip=None,
    )
    assert include_event(
        focus="stream",
        channel="infra",
        event_type="watchpot.agent.infra_snapshot",
        event_id="evt-4",
        matched=False,
        source_ips=set(),
        command_event_ids=set(),
        src_ip=None,
    )
    assert not include_event(
        focus="threats",
        channel="runtime",
        event_type="watchpot.agent.container_logs",
        event_id="evt-9",
        matched=False,
        source_ips={"203.0.113.10"},
        command_event_ids=set(),
        src_ip="203.0.113.10",
    )


def test_source_ips_and_payload_redaction() -> None:
    ips = event_source_ips(
        payload={
            "enrichment": {"source_ips": ["203.0.113.10", "203.0.113.10"]},
            "src_ip": "8.8.8.8",
            "password": "secret",
        },
        raw_log=None,
        service_name="cowrie",
        event_type="watchpot.agent.container_logs",
    )
    assert ips[0] == "203.0.113.10"
    assert "8.8.8.8" in ips
    slim, truncated = prepare_payload({"password": "hunter2", "nested": {"api_key": "abc"}, "container": "cowrie"})
    assert slim is not None
    assert slim["password"] == "***"
    assert slim["nested"]["api_key"] == "***"
    assert slim["container"] == "cowrie"
    assert truncated is False
    assert redact_text('login password=hunter2') == "login password=***"
    assert "hunter2" not in redact_text('{"password": "hunter2"}')


def test_markdown_and_html_exports_keep_evidence_and_escape_markup() -> None:
    report = _report()
    markdown = render_markdown(report)
    assert markdown.startswith("# Edge pot intrusion\n")
    assert "uname -a" in markdown
    assert "Looks like a Cowrie session" in markdown
    assert "203.0.113.10" in markdown
    assert "## 9. Evidence" in markdown

    document = render_html(report)
    assert "<script>" not in document
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in document
    assert "uname -a" in document
    assert "hunter2" not in document
    assert "***" in document
    assert document.startswith("<!DOCTYPE html>")


def test_empty_report_explains_the_gap() -> None:
    scope = _scope(analyst_notes="")
    paragraphs = write_paragraphs(scope, ReportCounts(), [], [], [], [])
    assert any("Nothing in the retained data" in paragraph for paragraph in paragraphs)
    markdown = render_markdown(
        IncidentReport(
            scope=scope,
            paragraphs=paragraphs,
            counts=ReportCounts(),
            pots=[],
            services=[],
            attackers=[],
            by_attack_type=[],
            by_tool=[],
            by_severity=[],
            by_technique=[],
            usernames=[],
            timeline=[],
            commands=[],
            cves=[],
        )
    )
    assert "No analyst notes" in markdown
    assert "No events were included" in markdown


def test_report_filename_is_portable() -> None:
    name = report_filename("Edge pot: intrusion / writeup", datetime(2026, 10, 12, 15, 4, tzinfo=UTC), "md")
    assert name.startswith("watchpot-edge-pot-intrusion-writeup-")
    assert name.endswith(".md")
    assert "/" not in name
    assert " " not in name
