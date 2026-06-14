"""Preset monitoring dashboard layouts (widget positions + defaults).

Each preset is tuned for dense Grafana-style panels: headless KPI tiles, clear chart
headers, and purpose-specific ranges. Config keys:
  show_header       — hide title bar (stats/KPI rows)
  compact           — compact comparison tile (comparison_24h only)
  use_global_range  — false keeps panel on its own range when dashboard range changes
"""

from __future__ import annotations

from typing import Any

# grid: 12 columns; w,h in react-grid-layout units (row height ~28px in UI).

def _kpi(range_: str = "24h") -> dict[str, Any]:
    return {"range": range_, "show_header": False}


def _chart(range_: str = "24h", **extra: Any) -> dict[str, Any]:
    return {"range": range_, **extra}


def _fixed(**extra: Any) -> dict[str, Any]:
    return extra


PRESETS: dict[str, list[dict[str, Any]]] = {
    # ── SOC / SIEM ─────────────────────────────────────────────────────────
    # KPI strip → volume + severity → threat breakdown → ops context → live feed
    "siem": [
        # KPI row (headless)
        {"widget_type": "stat_total", "title": "Events", "x": 0, "y": 0, "w": 2, "h": 3, "config": _kpi("24h")},
        {"widget_type": "stat_rate", "title": "Rate / hr", "x": 2, "y": 0, "w": 2, "h": 3, "config": _kpi("24h")},
        {
            "widget_type": "comparison_24h",
            "title": "24h change",
            "x": 4,
            "y": 0,
            "w": 3,
            "h": 3,
            "config": _fixed(show_header=False, compact=True),
        },
        {
            "widget_type": "pie_severity",
            "title": "Severity mix",
            "x": 7,
            "y": 0,
            "w": 5,
            "h": 6,
            "config": _chart("24h"),
        },
        {
            "widget_type": "timeseries_line",
            "title": "Event volume",
            "x": 0,
            "y": 2,
            "w": 7,
            "h": 5,
            "config": _chart("24h", bucket="hour"),
        },
        {
            "widget_type": "area_severity",
            "title": "Severity timeline",
            "x": 0,
            "y": 7,
            "w": 12,
            "h": 4,
            "config": _chart("24h"),
        },
        {
            "widget_type": "bar_event_type",
            "title": "Top event types",
            "x": 0,
            "y": 11,
            "w": 6,
            "h": 5,
            "config": _chart("24h", limit=8),
        },
        {
            "widget_type": "bar_source",
            "title": "Top sources",
            "x": 6,
            "y": 11,
            "w": 6,
            "h": 5,
            "config": _chart("24h", limit=8),
        },
        {
            "widget_type": "top_pots",
            "title": "Top honeypots",
            "x": 0,
            "y": 16,
            "w": 4,
            "h": 4,
            "config": _chart("24h", limit=6),
        },
        {
            "widget_type": "heatmap_hours",
            "title": "Activity by hour (7d)",
            "x": 4,
            "y": 16,
            "w": 8,
            "h": 4,
            "config": _chart("7d", use_global_range=False),
        },
        {
            "widget_type": "table_recent",
            "title": "Live event feed",
            "x": 0,
            "y": 20,
            "w": 12,
            "h": 7,
            "config": _fixed(limit=30),
        },
    ],
    # ── Honeypot operations ───────────────────────────────────────────────
    # 7-day trap focus: volume trend, busiest pots/stacks, attack patterns
    "honeypot": [
        {"widget_type": "stat_total", "title": "7d events", "x": 0, "y": 0, "w": 2, "h": 3, "config": _kpi("7d")},
        {"widget_type": "stat_rate", "title": "Avg / hr", "x": 2, "y": 0, "w": 2, "h": 3, "config": _kpi("7d")},
        {
            "widget_type": "comparison_24h",
            "title": "24h change",
            "x": 4,
            "y": 0,
            "w": 3,
            "h": 3,
            "config": _fixed(show_header=False, compact=True),
        },
        {
            "widget_type": "pie_severity",
            "title": "Severity mix",
            "x": 7,
            "y": 0,
            "w": 5,
            "h": 6,
            "config": _chart("7d"),
        },
        {
            "widget_type": "timeseries_line",
            "title": "Daily volume",
            "x": 0,
            "y": 2,
            "w": 7,
            "h": 5,
            "config": _chart("7d", bucket="day"),
        },
        {
            "widget_type": "top_pots",
            "title": "Busiest pots",
            "x": 0,
            "y": 7,
            "w": 5,
            "h": 5,
            "config": _chart("7d", limit=8),
        },
        {
            "widget_type": "stacks_bar",
            "title": "Events by stack",
            "x": 5,
            "y": 7,
            "w": 7,
            "h": 5,
            "config": _chart("7d", limit=8),
        },
        {
            "widget_type": "bar_event_type",
            "title": "Attack types",
            "x": 0,
            "y": 12,
            "w": 6,
            "h": 5,
            "config": _chart("7d", limit=10),
        },
        {
            "widget_type": "heatmap_hours",
            "title": "Trap activity pattern",
            "x": 6,
            "y": 12,
            "w": 6,
            "h": 4,
            "config": _chart("7d", use_global_range=False),
        },
        {
            "widget_type": "table_recent",
            "title": "Latest trap events",
            "x": 0,
            "y": 17,
            "w": 12,
            "h": 7,
            "config": _fixed(limit=25),
        },
    ],
    # ── Executive / minimal ─────────────────────────────────────────────────
    # At-a-glance health: KPIs, trend, severity, top pot, recent activity
    "minimal": [
        {"widget_type": "stat_total", "title": "Events", "x": 0, "y": 0, "w": 2, "h": 3, "config": _kpi("24h")},
        {"widget_type": "stat_rate", "title": "Rate / hr", "x": 2, "y": 0, "w": 2, "h": 3, "config": _kpi("24h")},
        {
            "widget_type": "comparison_24h",
            "title": "24h change",
            "x": 4,
            "y": 0,
            "w": 3,
            "h": 3,
            "config": _fixed(show_header=False, compact=True),
        },
        {
            "widget_type": "pie_severity",
            "title": "Severity",
            "x": 7,
            "y": 0,
            "w": 5,
            "h": 4,
            "config": _chart("24h"),
        },
        {
            "widget_type": "timeseries_line",
            "title": "24h volume",
            "x": 0,
            "y": 2,
            "w": 7,
            "h": 4,
            "config": _chart("24h", bucket="hour"),
        },
        {
            "widget_type": "top_pots",
            "title": "Top pots",
            "x": 7,
            "y": 4,
            "w": 5,
            "h": 4,
            "config": _chart("24h", limit=5),
        },
        {
            "widget_type": "table_recent",
            "title": "Recent activity",
            "x": 0,
            "y": 8,
            "w": 12,
            "h": 6,
            "config": _fixed(limit=20),
        },
    ],
    # ── Network / ingest ────────────────────────────────────────────────────
    # Throughput, sources, services, stacks, raw ingest stream
    "network": [
        {"widget_type": "stat_rate", "title": "Ingest / hr", "x": 0, "y": 0, "w": 2, "h": 3, "config": _kpi("24h")},
        {"widget_type": "stat_total", "title": "24h total", "x": 2, "y": 0, "w": 2, "h": 3, "config": _kpi("24h")},
        {
            "widget_type": "comparison_24h",
            "title": "24h change",
            "x": 4,
            "y": 0,
            "w": 3,
            "h": 3,
            "config": _fixed(show_header=False, compact=True),
        },
        {
            "widget_type": "donut_source",
            "title": "Source mix",
            "x": 7,
            "y": 0,
            "w": 5,
            "h": 5,
            "config": _chart("24h", limit=8),
        },
        {
            "widget_type": "timeseries_line",
            "title": "Ingest throughput",
            "x": 0,
            "y": 2,
            "w": 7,
            "h": 5,
            "config": _chart("7d", bucket="hour", use_global_range=False),
        },
        {
            "widget_type": "bar_source",
            "title": "Top ingest sources",
            "x": 0,
            "y": 7,
            "w": 7,
            "h": 5,
            "config": _chart("24h", limit=12),
        },
        {
            "widget_type": "stack_services",
            "title": "By service",
            "x": 7,
            "y": 7,
            "w": 5,
            "h": 5,
            "config": _chart("24h"),
        },
        {
            "widget_type": "stacks_bar",
            "title": "By stack (7d)",
            "x": 0,
            "y": 12,
            "w": 12,
            "h": 4,
            "config": _chart("7d", limit=10, use_global_range=False),
        },
        {
            "widget_type": "log_stream",
            "title": "Ingest stream",
            "x": 0,
            "y": 16,
            "w": 12,
            "h": 6,
            "config": _fixed(limit=25),
        },
    ],
}


def list_preset_keys() -> list[str]:
    return sorted(PRESETS.keys())
