"""Library categorization: status and the confirmed background job."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from ...organize.service import LibraryOrganizer


class OrganizeBody(BaseModel):
    confirm: bool = False
    force_taxonomy: bool = False


def register(app: FastAPI, *, organizer: LibraryOrganizer | None) -> None:
    """Attach the organize routes."""

    @app.get("/api/organize/status")
    def api_organize_status() -> dict[str, object]:
        if organizer is None:
            return {"available": False, "running": False, "reason": "Mistral is not configured"}
        return organizer.status()

    @app.post("/api/organize", status_code=202)
    def api_organize(body: OrganizeBody) -> dict[str, object]:
        if organizer is None:
            raise HTTPException(
                status_code=503,
                detail="Mistral is not configured; set MISTRAL_API_KEY or MISTRAL_API",
            )
        if not body.confirm:
            raise HTTPException(status_code=400, detail="organize requires confirm=true")
        if not organizer.start(force_taxonomy=body.force_taxonomy):
            raise HTTPException(status_code=409, detail="organize is already running")
        return {"started": True, "status": organizer.status()}
