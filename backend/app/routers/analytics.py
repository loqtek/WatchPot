"""Aggregated analytics for monitoring widgets (logging / event layer).

All routes require an operator JWT. Response bodies must be JSON-serializable dicts only
(use string widget kinds, never the name ``type`` as a value — the query param is aliased
``type`` but the Python parameter is ``widget_type``).
"""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.services import analytics_events as ax
from app.services import enrichment_analytics as ex

router = APIRouter(prefix="/analytics", tags=["analytics"])

ALLOWED_RANGES = ax.ALLOWED_RANGE_KEYS


VALID_WIDGET_TYPES = frozenset(
    {
        "stat_total",
        "stat_rate",
        "comparison_24h",
        "pie_severity",
        "donut_source",
        "bar_source",
        "bar_event_type",
        "horizontal_types",
        "timeseries_line",
        "area_severity",
        "top_pots",
        "heatmap_hours",
        "table_recent",
        "log_stream",
        "radar_types",
        "stack_services",
        "stacks_bar",
        "bar_attack_type",
        "bar_tool",
        "bar_cve",
        "enrichment_summary",
    }
)


@router.get("/dashboard")
async def dashboard(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    range_key: str = Query("1d", alias="range"),
) -> dict[str, Any]:
    if range_key not in ALLOWED_RANGES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid range")
    return await ax.dashboard_overview(db, range_key=range_key)


@router.get("/widget")
async def widget_data(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    widget_type: str = Query(..., alias="type", description="Widget type key"),
    range_key: str = Query("24h", alias="range"),
    pot_id: UUID | None = None,
    bucket: str = Query("hour", description="hour or day for time series"),
    limit: int = Query(10, ge=1, le=100),
) -> dict[str, Any]:
    if range_key not in ALLOWED_RANGES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid range")
    if widget_type not in VALID_WIDGET_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown widget type: {widget_type}",
        )
    rk = range_key
    pid = pot_id

    match widget_type:
        case "stat_total":
            s = await ax.summary(db, range_key=rk, pot_id=pid)
            return {"kind": "stat_total", "value": s["total"], "subtitle": rk}
        case "stat_rate":
            s = await ax.summary(db, range_key=rk, pot_id=pid)
            return {"kind": "stat_rate", "value": s["rate_per_hour"], "subtitle": "per hour"}
        case "comparison_24h":
            c = await ax.comparison_periods(db, range_key=rk, pot_id=pid)
            return {"kind": "comparison_24h", **c}
        case "pie_severity":
            s = await ax.summary(db, range_key=rk, pot_id=pid)
            return {"kind": "pie_severity", "items": s["by_severity"]}
        case "donut_source" | "bar_source":
            s = await ax.summary(db, range_key=rk, pot_id=pid)
            return {"kind": widget_type, "items": s["by_source"][:limit]}
        case "bar_event_type":
            s = await ax.summary(db, range_key=rk, pot_id=pid)
            return {"kind": "bar_event_type", "items": s["by_event_type"][:limit]}
        case "horizontal_types":
            s = await ax.summary(db, range_key=rk, pot_id=pid)
            return {"kind": "horizontal_types", "items": s["by_event_type"][:limit]}
        case "timeseries_line":
            b = bucket if bucket in ("hour", "day") else "hour"
            ts = await ax.timeseries(db, range_key=rk, bucket=b, pot_id=pid)
            return {"kind": "timeseries_line", **ts}
        case "area_severity":
            ts = await ax.timeseries_by_severity(db, range_key=rk, pot_id=pid)
            return {"kind": "area_severity", **ts}
        case "top_pots":
            rows = await ax.top_pots(db, range_key=rk, limit=limit)
            return {"kind": "top_pots", "items": rows}
        case "heatmap_hours":
            h = await ax.heatmap_hour_of_day(db, range_key=rk, pot_id=pid)
            return {"kind": "heatmap_hours", **h}
        case "table_recent" | "log_stream":
            rows = await ax.recent_events(db, limit=limit, pot_id=pid)
            return {"kind": widget_type, "items": rows}
        case "radar_types":
            r = await ax.radar_event_types(db, range_key=rk, pot_id=pid)
            return {"kind": "radar_types", **r}
        case "stack_services":
            st = await ax.stack_by_service(db, range_key=rk, pot_id=pid)
            return {"kind": "stack_services", **st}
        case "stacks_bar":
            rows = await ax.events_by_stack(db, range_key=rk, limit=limit)
            return {"kind": "stacks_bar", "items": rows}
        case "bar_attack_type":
            return await ex.enrichment_breakdown(db, range_key=rk, dimension="attack_type", pot_id=pid, limit=limit)
        case "bar_tool":
            return await ex.enrichment_breakdown(db, range_key=rk, dimension="tool", pot_id=pid, limit=limit)
        case "bar_cve":
            return await ex.enrichment_breakdown(db, range_key=rk, dimension="cve", pot_id=pid, limit=limit)
        case "enrichment_summary":
            s = await ex.enrichment_stats(db, range_key=rk, pot_id=pid, limit=limit)
            return {
                "kind": "enrichment_summary",
                "matched_events": s["matched_events"],
                "enriched_events": s["enriched_events"],
                "enrichment_rate": s["enrichment_rate"],
                "rules_enabled": s["rules_enabled"],
                "cve_cache_size": s["cve_cache_size"],
            }
        case _:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unhandled widget: {widget_type}")
