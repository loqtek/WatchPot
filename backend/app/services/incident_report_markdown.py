"""Markdown export for an incident report."""

from __future__ import annotations

from app.schemas.incident_report import IncidentReport, ReportAttacker, ReportCommand, ReportEvent
from app.services.incident_report_format import (
    KIND_ORDER,
    describe_place,
    format_ts,
    label_attack,
    label_kind,
    md_fence,
    md_quote,
    md_table,
    yes_no,
)


def render_markdown(report: IncidentReport) -> str:
    scope = report.scope
    parts: list[str] = [
        f"# {scope.title}",
        "",
        "_watchPot incident report. All timestamps are UTC._",
        "",
        md_table(
            ["Field", "Value"],
            [
                ["Generated", f"{format_ts(scope.generated_at)} by {scope.generated_by}"],
                ["Window", f"{format_ts(scope.since)} → {format_ts(scope.until)}"],
                ["Focus", scope.focus_label],
                ["Pot", _pot_line(scope.pot_name, scope.pot_id)],
                ["Source", scope.src_ip or "Any"],
                ["Raw logs", "Included" if scope.include_raw else "Omitted"],
            ],
        ),
        "",
        "## 1. Executive summary",
        "",
        "\n\n".join(report.paragraphs),
        "",
        "## 2. Analyst notes",
        "",
    ]
    if scope.analyst_notes:
        parts.append(md_quote(scope.analyst_notes))
    else:
        parts.append("_No analyst notes were added to this export._")
    parts.extend(["", "## 3. Scope", ""])
    if report.pots:
        parts.append(
            md_table(
                ["Pot", "Events", "Commands", "Last agent IP", "Id"],
                [
                    [pot.name, str(pot.event_count), str(pot.command_count), pot.last_ip or "—", pot.id]
                    for pot in report.pots
                ],
            )
        )
        described = [pot for pot in report.pots if pot.description]
        if described:
            parts.append("")
            for pot in described:
                parts.append(f"**{pot.name}.** {pot.description}")
                parts.append("")
    else:
        parts.append("_No pots were in scope._")
        parts.append("")
    if report.services:
        parts.append("Services and containers: " + ", ".join(f"`{name}`" for name in report.services) + ".")
        parts.append("")

    parts.extend(["## 4. Indicators", ""])
    parts.extend(_bullet_section("Source addresses", [attacker.ip_address for attacker in report.attackers]))
    parts.extend(_bullet_section("Usernames", report.usernames))
    parts.extend(_bullet_section("Tools", [item.label for item in report.by_tool]))
    parts.extend(
        _bullet_section(
            "Attack types",
            [f"{item.label} ({item.count})" for item in report.by_attack_type],
        )
    )
    parts.extend(_bullet_section("Techniques", [item.label for item in report.by_technique]))
    parts.extend(_bullet_section("Vulnerabilities", [item.cve_id for item in report.cves]))
    if report.counts.events or report.counts.commands:
        parts.append(
            "Severity mix: "
            + ", ".join(f"{item.label} {item.count}" for item in report.by_severity)
            + "."
        )
        parts.append("")

    parts.extend(["## 5. Attacker profiles", ""])
    if not report.attackers:
        parts.append("_No source addresses were recorded for this scope._")
        parts.append("")
    for attacker in report.attackers:
        parts.extend(_attacker_md(attacker))

    parts.extend(["## 6. Activity timeline", ""])
    if report.timeline:
        parts.append(
            md_table(
                ["Time (UTC)", "Pot", "Service", "Severity", "What happened", "Attribution"],
                [_timeline_row(event) for event in report.timeline],
            )
        )
        parts.append("")
        parts.append("Full payloads and log excerpts are in the evidence section.")
        parts.append("")
    else:
        parts.append("_No events were included._")
        parts.append("")

    parts.extend(["## 7. Commands and requests", ""])
    if not report.commands:
        parts.append("_No shell commands, HTTP requests, logins, or downloads were captured in this scope._")
        parts.append("")
    else:
        parts.extend(_commands_md(report.commands))

    parts.extend(["## 8. Vulnerability correlation", ""])
    if not report.cves:
        parts.append("_No CVEs were correlated with this activity._")
        parts.append("")
    for cve in report.cves:
        parts.extend(_cve_md(cve))

    parts.extend(["## 9. Evidence", ""])
    if not report.timeline:
        parts.append("_No event evidence was included._")
        parts.append("")
    for index, event in enumerate(report.timeline, start=1):
        parts.extend(_evidence_md(index, event))

    parts.extend(["## 10. Appendix", ""])
    if scope.truncation_notes:
        parts.append("Limits applied to this export:")
        parts.append("")
        for note in scope.truncation_notes:
            parts.append(f"- {note}")
        parts.append("")
    else:
        parts.append("This export was not truncated.")
        parts.append("")
    parts.append(f"Event ids ({len(report.timeline)}):")
    parts.append("")
    if report.timeline:
        parts.append("\n".join(f"- `{event.id}`" for event in report.timeline))
    else:
        parts.append("_None._")
    parts.append("")
    parts.append(f"Command ids ({len(report.commands)}):")
    parts.append("")
    if report.commands:
        parts.append("\n".join(f"- `{command.id}`" for command in report.commands))
    else:
        parts.append("_None._")
    parts.append("")
    parts.append("---")
    parts.append("")
    parts.append(f"_Generated by watchPot on {format_ts(scope.generated_at)}._")
    parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def _pot_line(name: str | None, pot_id: str | None) -> str:
    if name and pot_id:
        return f"{name} ({pot_id})"
    return name or pot_id or "All pots"


def _bullet_section(title: str, values: list[str]) -> list[str]:
    lines = [f"### {title}", ""]
    if not values:
        lines.append("_None recorded._")
    else:
        lines.extend(f"- `{value}`" if " " not in value else f"- {value}" for value in values)
    lines.append("")
    return lines


def _attacker_md(attacker: ReportAttacker) -> list[str]:
    geo = attacker.geo
    place = describe_place(geo.city, geo.region, geo.country) if geo else None
    network = None
    if geo:
        network = geo.asn_label or geo.org or geo.isp
    rows = [
        ["Status", attacker.status + ("" if attacker.tracked else " (not in the IP tracker)")],
        ["Location", place or "—"],
        ["Network", network or "—"],
        ["ISP", geo.isp if geo and geo.isp else "—"],
        ["Abuse score", str(attacker.abuse_score) if attacker.abuse_score is not None else "—"],
        ["Tor exit", yes_no(attacker.is_tor)],
        ["Hosting", yes_no(attacker.is_hosting)],
        ["Proxy", yes_no(geo.is_proxy) if geo else "—"],
        ["Tracker hits", str(attacker.hit_count) if attacker.hit_count is not None else "—"],
        ["Commands in this report", str(attacker.command_count)],
        ["Events in this report", str(attacker.event_count)],
        ["First seen", format_ts(attacker.first_seen_at)],
        ["Last seen", format_ts(attacker.last_seen_at)],
        ["Usernames", ", ".join(attacker.usernames) or "—"],
        ["Attack types", ", ".join(label_attack(item) for item in attacker.attack_types) or "—"],
        ["Tools", ", ".join(attacker.tools) or "—"],
        ["CVEs", ", ".join(attacker.cve_ids) or "—"],
        ["Tags", ", ".join(attacker.tags) or "—"],
    ]
    lines = [f"### {attacker.ip_address}", "", md_table(["Field", "Value"], rows), ""]
    if attacker.user_notes:
        lines.extend(["Operator notes:", "", md_quote(attacker.user_notes), ""])
    return lines


def _timeline_row(event: ReportEvent) -> list[str]:
    attribution = []
    if event.source_ips:
        attribution.append(", ".join(event.source_ips))
    if event.attack_types:
        attribution.append(", ".join(label_attack(item) for item in event.attack_types))
    if event.tools:
        attribution.append(", ".join(event.tools))
    if event.cve_ids:
        attribution.append(", ".join(event.cve_ids))
    what = event.summary or event.event_title
    return [
        format_ts(event.received_at),
        event.pot_name or event.pot_id,
        event.service_name or "—",
        event.severity,
        what,
        " · ".join(attribution) or "—",
    ]


def _commands_md(commands: list[ReportCommand]) -> list[str]:
    lines: list[str] = []
    by_kind: dict[str, list[ReportCommand]] = {}
    for command in commands:
        by_kind.setdefault(command.kind, []).append(command)
    kinds = [kind for kind in KIND_ORDER if kind in by_kind]
    kinds.extend(kind for kind in by_kind if kind not in KIND_ORDER)
    number = 1
    for kind in kinds:
        lines.extend([f"### {label_kind(kind)}", ""])
        groups: dict[tuple[str, str, str, str, str], list[ReportCommand]] = {}
        order: list[tuple[str, str, str, str, str]] = []
        for command in by_kind[kind]:
            key = (
                command.session_id or "",
                command.src_ip or "",
                command.username or "",
                command.pot_id,
                command.container or "",
            )
            if key not in groups:
                order.append(key)
                groups[key] = []
            groups[key].append(command)
        for key in order:
            sample = groups[key][0]
            lines.extend([f"#### {_group_heading(sample)}", ""])
            for command in groups[key]:
                lines.extend(_one_command(number, command))
                number += 1
    return lines


def _group_heading(command: ReportCommand) -> str:
    bits = [f"Session `{command.session_id}`" if command.session_id else "No session id"]
    if command.src_ip:
        bits.append(f"`{command.src_ip}`")
    if command.username:
        bits.append(f"user `{command.username}`")
    if command.pot_name:
        bits.append(command.pot_name)
    if command.container:
        bits.append(f"container `{command.container}`")
    return " · ".join(bits)


def _one_command(number: int, command: ReportCommand) -> list[str]:
    when = format_ts(command.observed_at)
    repeats = ""
    if command.hit_count > 1:
        repeats = (
            f" Observed {command.hit_count} times"
            f" ({format_ts(command.first_seen_at)} → {format_ts(command.last_seen_at)})."
        )
    meta = f"**{number}.** {when}.{repeats}"
    if command.event_id:
        meta += f" Event `{command.event_id}`."
    lines = [meta, "", md_fence(command.command), ""]
    if command.context:
        lines.extend(["Surrounding log:", "", md_fence(command.context), ""])
    return lines


def _cve_md(cve) -> list[str]:
    score = f"{cve.cvss_score:g}" if cve.cvss_score is not None else "—"
    product = " ".join(part for part in (cve.vendor, cve.product) if part) or "—"
    lines = [
        f"### {cve.cve_id}",
        "",
        md_table(
            ["Field", "Value"],
            [
                ["Severity", cve.severity or "—"],
                ["CVSS", score],
                ["Category", cve.category or "—"],
                ["Product", product],
                ["In local cache", "Yes" if cve.in_cache else "No — id only, or taken from the event"],
                ["Events", str(cve.event_count)],
                ["Source addresses", ", ".join(cve.source_ips) or "—"],
            ],
        ),
        "",
    ]
    if cve.summary:
        lines.extend([cve.summary, ""])
    if cve.notes:
        lines.extend(["Cache notes:", "", md_quote(cve.notes), ""])
    if cve.references:
        lines.append("References:")
        lines.append("")
        lines.extend(f"- {ref}" for ref in cve.references)
        lines.append("")
    return lines


def _evidence_md(index: int, event: ReportEvent) -> list[str]:
    lines = [
        f"### {index}. {event.event_title}",
        "",
        md_table(
            ["Field", "Value"],
            [
                ["Event id", event.id],
                ["Time", format_ts(event.received_at)],
                ["Pot", _pot_line(event.pot_name, event.pot_id)],
                ["Stack", event.stack_name or event.stack_id or "—"],
                ["Service", event.service_name or "—"],
                ["Type", event.event_type],
                ["Channel", event.channel],
                ["Source", event.source],
                ["Severity", event.severity],
                ["Summary", event.summary or "—"],
                ["Source addresses", ", ".join(event.source_ips) or "—"],
                ["Enrichment", event.enrichment_status or "—"],
                ["Confidence", _confidence(event.confidence)],
                ["Attack types", ", ".join(label_attack(item) for item in event.attack_types) or "—"],
                ["Tools", ", ".join(event.tools) or "—"],
                ["Techniques", ", ".join(event.techniques) or "—"],
                ["Rules", ", ".join(event.rule_names) or "—"],
                ["CVEs", ", ".join(event.cve_ids) or "—"],
            ],
        ),
        "",
    ]
    for detail in event.cve_details:
        score = f", CVSS {detail.cvss_score:g}" if detail.cvss_score is not None else ""
        summary = detail.summary or "No summary stored."
        lines.append(f"- **{detail.cve_id}** ({detail.severity or 'unknown'}{score}): {summary}")
    if event.cve_details:
        lines.append("")
    if event.payload:
        note = " Payload was shortened." if event.payload_truncated else ""
        lines.extend([f"Payload.{note}".strip(), "", md_fence(_payload_text(event.payload), "json"), ""])
    if event.raw_log:
        note = " Log was shortened." if event.raw_log_truncated else ""
        lines.extend([f"Raw log.{note}".strip(), "", md_fence(event.raw_log), ""])
    elif event.raw_log is None:
        lines.extend(["_Raw log was not included._", ""])
    return lines


def _confidence(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{round(value * 100)}%"


def _payload_text(payload: dict) -> str:
    import json

    return json.dumps(payload, indent=2, ensure_ascii=False, default=str)
