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


def _tile(widget_type: str, title: str, x: int, y: int, w: int, h: int, config: dict[str, Any]) -> dict[str, Any]:
    return {"widget_type": widget_type, "title": title, "x": x, "y": y, "w": w, "h": h, "config": config}


PRESETS: dict[str, list[dict[str, Any]]] = {
    # Rows never overlap. KPI tiles are headless; charts keep a single-line title.
    "siem": [
        _tile("stat_total", "Events", 0, 0, 4, 3, _kpi("24h")),
        _tile("stat_rate", "Rate / hr", 4, 0, 4, 3, _kpi("24h")),
        _tile("comparison_24h", "24h change", 8, 0, 4, 3, _fixed(show_header=False, compact=True)),
        _tile("timeseries_line", "Event volume", 0, 3, 8, 7, _chart("24h", bucket="hour")),
        _tile("pie_severity", "Severity", 8, 3, 4, 7, _chart("24h")),
        _tile("bar_event_type", "Top event types", 0, 10, 6, 6, _chart("24h", limit=8)),
        _tile("bar_source", "Top sources", 6, 10, 6, 6, _chart("24h", limit=8)),
        _tile("top_pots", "Top honeypots", 0, 16, 4, 6, _chart("24h", limit=6)),
        _tile("heatmap_hours", "Activity by hour", 4, 16, 8, 6, _chart("7d", use_global_range=False)),
        _tile("table_recent", "Live event feed", 0, 22, 12, 8, _fixed(limit=30)),
    ],
    "honeypot": [
        _tile("stat_total", "7d events", 0, 0, 4, 3, _kpi("7d")),
        _tile("stat_rate", "Avg / hr", 4, 0, 4, 3, _kpi("7d")),
        _tile("comparison_24h", "24h change", 8, 0, 4, 3, _fixed(show_header=False, compact=True)),
        _tile("timeseries_line", "Daily volume", 0, 3, 8, 7, _chart("7d", bucket="day")),
        _tile("pie_severity", "Severity", 8, 3, 4, 7, _chart("7d")),
        _tile("top_pots", "Busiest pots", 0, 10, 6, 6, _chart("7d", limit=8)),
        _tile("stacks_bar", "Events by stack", 6, 10, 6, 6, _chart("7d", limit=8)),
        _tile("bar_event_type", "Attack types", 0, 16, 6, 6, _chart("7d", limit=10)),
        _tile("heatmap_hours", "Activity by hour", 6, 16, 6, 6, _chart("7d", use_global_range=False)),
        _tile("table_recent", "Latest trap events", 0, 22, 12, 8, _fixed(limit=25)),
    ],
    "minimal": [
        _tile("stat_total", "Events", 0, 0, 4, 3, _kpi("24h")),
        _tile("stat_rate", "Rate / hr", 4, 0, 4, 3, _kpi("24h")),
        _tile("comparison_24h", "24h change", 8, 0, 4, 3, _fixed(show_header=False, compact=True)),
        _tile("timeseries_line", "Event volume", 0, 3, 8, 7, _chart("24h", bucket="hour")),
        _tile("pie_severity", "Severity", 8, 3, 4, 7, _chart("24h")),
        _tile("top_pots", "Top pots", 0, 10, 4, 6, _chart("24h", limit=6)),
        _tile("table_recent", "Recent activity", 4, 10, 8, 6, _fixed(limit=20)),
    ],
    "network": [
        _tile("stat_rate", "Ingest / hr", 0, 0, 4, 3, _kpi("24h")),
        _tile("stat_total", "24h total", 4, 0, 4, 3, _kpi("24h")),
        _tile("comparison_24h", "24h change", 8, 0, 4, 3, _fixed(show_header=False, compact=True)),
        _tile("timeseries_line", "Ingest throughput", 0, 3, 8, 7, _chart("24h", bucket="hour")),
        _tile("donut_source", "Source mix", 8, 3, 4, 7, _chart("24h", limit=8)),
        _tile("bar_source", "Top sources", 0, 10, 7, 6, _chart("24h", limit=10)),
        _tile("stack_services", "By service", 7, 10, 5, 6, _chart("24h")),
        _tile("stacks_bar", "By stack", 0, 16, 12, 5, _chart("7d", limit=10, use_global_range=False)),
        _tile("log_stream", "Ingest stream", 0, 21, 12, 7, _fixed(limit=25)),
    ],
}


def list_preset_keys() -> list[str]:
    return sorted(PRESETS.keys())
