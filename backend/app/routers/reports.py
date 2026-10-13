"""Incident report exports for honeypot writeups."""

from __future__ import annotations

import json
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit_service import write_audit
from app.database import get_db
from app.deps import require_admin_user
from app.models.user import User
from app.schemas.incident_report import IncidentReport, IncidentReportRequest
from app.services.incident_report import ReportError, build_incident_report
from app.services.incident_report_format import report_filename
from app.services.incident_report_html import render_html
from app.services.incident_report_markdown import render_markdown

router = APIRouter(prefix="/reports", tags=["reports"])


def _actor(user: User) -> str:
    return (user.username or user.email or "operator").strip()


async def _build(
    body: IncidentReportRequest,
    user: User,
    db: AsyncSession,
) -> IncidentReport:
    try:
        return await build_incident_report(db, body, exported_by=_actor(user))
    except ReportError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _audit_detail(report: IncidentReport, export_format: str) -> dict:
    scope = report.scope
    return {
        "format": export_format,
        "focus": scope.focus,
        "range": scope.range_key,
        "pot_id": scope.pot_id,
        "src_ip": scope.src_ip,
        "events": report.counts.events,
        "commands": report.counts.commands,
    }


@router.post("/incident", response_model=IncidentReport)
async def create_incident_report(
    body: IncidentReportRequest,
    request: Request,
    user: Annotated[User, Depends(require_admin_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> IncidentReport:
    report = await _build(body, user, db)
    await write_audit(
        db,
        action="report.incident.build",
        actor_user_id=user.id,
        resource_type="incident_report",
        detail=_audit_detail(report, "json"),
        ip_address=request.client.host if request.client else None,
    )
    return report


@router.post("/incident/export")
async def export_incident_report(
    body: IncidentReportRequest,
    request: Request,
    user: Annotated[User, Depends(require_admin_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    export_format: Annotated[Literal["markdown", "html", "json"], Query(alias="format")] = "markdown",
) -> Response:
    report = await _build(body, user, db)
    if export_format == "html":
        content = render_html(report)
        media_type = "text/html"
        ext = "html"
    elif export_format == "json":
        content = json.dumps(report.model_dump(mode="json"), indent=2, ensure_ascii=False)
        media_type = "application/json"
        ext = "json"
    else:
        content = render_markdown(report)
        media_type = "text/markdown"
        ext = "md"
    filename = report_filename(report.scope.title, report.scope.generated_at, ext)
    await write_audit(
        db,
        action="report.incident.export",
        actor_user_id=user.id,
        resource_type="incident_report",
        detail=_audit_detail(report, export_format),
        ip_address=request.client.host if request.client else None,
    )
    return Response(
        content=content.encode("utf-8"),
        media_type=f"{media_type}; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
