"""Persisted monitoring dashboards (editable widget layouts)."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dashboard_templates import PRESETS, list_preset_keys
from app.database import get_db
from app.deps import get_current_user
from app.models.operator_dashboard import OperatorDashboard, OperatorDashboardWidget
from app.models.user import User
from app.routers.analytics import VALID_WIDGET_TYPES
from app.schemas.operator_dashboard import (
    DashboardCreate,
    DashboardOut,
    DashboardUpdate,
    DashboardWidgetIn,
)

router = APIRouter(prefix="/dashboards", tags=["dashboards"])


@router.get("/templates")
async def list_templates(_: Annotated[User, Depends(get_current_user)]) -> dict[str, list[str]]:
    return {"templates": list_preset_keys()}


@router.get("", response_model=list[DashboardOut])
async def list_dashboards(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[OperatorDashboard]:
    result = await db.execute(
        select(OperatorDashboard)
        .where(OperatorDashboard.user_id == user.id)
        .options(selectinload(OperatorDashboard.widgets))
        .order_by(OperatorDashboard.updated_at.desc())
    )
    return list(result.scalars().all())


@router.get("/{dashboard_id}", response_model=DashboardOut)
async def get_dashboard(
    dashboard_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> OperatorDashboard:
    result = await db.execute(
        select(OperatorDashboard)
        .where(OperatorDashboard.id == dashboard_id, OperatorDashboard.user_id == user.id)
        .options(selectinload(OperatorDashboard.widgets))
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")
    return row


def _validate_widgets(widgets: list[DashboardWidgetIn]) -> None:
    for w in widgets:
        if w.widget_type not in VALID_WIDGET_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid widget type: {w.widget_type}",
            )


@router.post("", response_model=DashboardOut, status_code=status.HTTP_201_CREATED)
async def create_dashboard(
    body: DashboardCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> OperatorDashboard:
    if body.template_key is not None and body.template_key not in PRESETS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown template_key")

    prev_n = (
        await db.execute(
            select(func.count()).select_from(OperatorDashboard).where(OperatorDashboard.user_id == user.id)
        )
    ).scalar_one()
    is_first = int(prev_n) == 0

    dash = OperatorDashboard(
        user_id=user.id,
        name=body.name,
        grid_cols=body.grid_cols,
        is_default=is_first,
    )
    db.add(dash)
    await db.flush()

    if body.template_key:
        for i, spec in enumerate(PRESETS[body.template_key]):
            w = OperatorDashboardWidget(
                dashboard_id=dash.id,
                widget_type=spec["widget_type"],
                title=spec["title"],
                config=spec.get("config"),
                x=int(spec["x"]),
                y=int(spec["y"]),
                w=int(spec["w"]),
                h=int(spec["h"]),
                order_index=i,
            )
            db.add(w)
    await db.flush()
    await db.refresh(dash, ["widgets"])
    result = await db.execute(
        select(OperatorDashboard)
        .where(OperatorDashboard.id == dash.id)
        .options(selectinload(OperatorDashboard.widgets))
    )
    return result.scalar_one()


@router.put("/{dashboard_id}", response_model=DashboardOut)
async def update_dashboard(
    dashboard_id: UUID,
    body: DashboardUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> OperatorDashboard:
    result = await db.execute(
        select(OperatorDashboard).where(
            OperatorDashboard.id == dashboard_id,
            OperatorDashboard.user_id == user.id,
        )
    )
    dash = result.scalar_one_or_none()
    if dash is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")

    if body.name is not None:
        dash.name = body.name
    if body.grid_cols is not None:
        dash.grid_cols = body.grid_cols

    if body.widgets is not None:
        _validate_widgets(body.widgets)
        await db.execute(delete(OperatorDashboardWidget).where(OperatorDashboardWidget.dashboard_id == dashboard_id))
        for i, w in enumerate(body.widgets):
            db.add(
                OperatorDashboardWidget(
                    dashboard_id=dashboard_id,
                    widget_type=w.widget_type,
                    title=w.title,
                    config=w.config,
                    x=w.x,
                    y=w.y,
                    w=w.w,
                    h=w.h,
                    order_index=i,
                )
            )

    await db.flush()
    result2 = await db.execute(
        select(OperatorDashboard)
        .where(OperatorDashboard.id == dashboard_id)
        .options(selectinload(OperatorDashboard.widgets))
    )
    return result2.scalar_one()


@router.delete("/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dashboard(
    dashboard_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    result = await db.execute(
        select(OperatorDashboard).where(
            OperatorDashboard.id == dashboard_id,
            OperatorDashboard.user_id == user.id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")
    await db.execute(
        delete(OperatorDashboard).where(
            OperatorDashboard.id == dashboard_id,
            OperatorDashboard.user_id == user.id,
        )
    )
