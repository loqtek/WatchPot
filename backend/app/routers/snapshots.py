from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit_service import write_audit
from app.database import get_db
from app.deps import get_current_user
from app.models.pot import Pot
from app.models.snapshot import Snapshot
from app.models.user import User
from app.schemas.snapshot import SnapshotCreate, SnapshotOut

router = APIRouter(prefix="/snapshots", tags=["snapshots"])


@router.get("", response_model=list[SnapshotOut])
async def list_snapshots(
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    pot_id: UUID | None = None,
    limit: int = Query(200, ge=1, le=500),
) -> list[Snapshot]:
    q = select(Snapshot).order_by(Snapshot.created_at.desc()).limit(limit)
    if pot_id is not None:
        q = q.where(Snapshot.pot_id == pot_id)
    result = await db.execute(q)
    return list(result.scalars().all())


@router.post("", response_model=SnapshotOut, status_code=status.HTTP_201_CREATED)
async def create_snapshot(
    request: Request,
    body: SnapshotCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Snapshot:
    if body.pot_id is not None:
        pr = await db.execute(select(Pot).where(Pot.id == body.pot_id))
        if pr.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pot not found")
    _iid = (body.image_id or "").strip()
    snap = Snapshot(
        name=body.name,
        description=body.description,
        image_reference=body.image_reference.strip(),
        image_id=_iid or None,
        pot_id=body.pot_id,
        created_by_user_id=user.id,
        labels=body.labels,
    )
    db.add(snap)
    await db.flush()
    await write_audit(
        db,
        action="snapshot.create",
        actor_user_id=user.id,
        resource_type="snapshot",
        resource_id=str(snap.id),
        detail={"name": snap.name, "image_reference": snap.image_reference},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return snap


@router.get("/{snapshot_id}", response_model=SnapshotOut)
async def get_snapshot(
    snapshot_id: UUID,
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Snapshot:
    result = await db.execute(select(Snapshot).where(Snapshot.id == snapshot_id))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    return row


@router.delete("/{snapshot_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_snapshot(
    snapshot_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    result = await db.execute(select(Snapshot).where(Snapshot.id == snapshot_id))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    await db.execute(delete(Snapshot).where(Snapshot.id == snapshot_id))
    await write_audit(
        db,
        action="snapshot.delete",
        actor_user_id=user.id,
        resource_type="snapshot",
        resource_id=str(snapshot_id),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
