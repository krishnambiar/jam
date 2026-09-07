"""FastAPI application that serves the Untitled Jam frontend and API."""

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response

from untitled_jam.models import HealthResponse

PROJECT_ROOT = Path(__file__).resolve().parents[3]
FRONTEND_DIST = (PROJECT_ROOT / "dist").resolve()
INDEX_FILE = FRONTEND_DIST / "index.html"

app = FastAPI(
    title="Untitled Jam API",
    description="Python backend for the Untitled Jam whiteboard.",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    """Report that the FastAPI service is ready."""

    return HealthResponse()


def _frontend_file(path: str) -> Optional[Path]:
    """Resolve a requested frontend asset without allowing path traversal."""

    candidate = (FRONTEND_DIST / path).resolve()
    try:
        candidate.relative_to(FRONTEND_DIST)
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


@app.get("/{path:path}", include_in_schema=False, response_model=None)
async def frontend(path: str) -> Response:
    """Serve built assets and fall back to the SPA entry point."""

    if path == "api" or path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API endpoint not found")

    asset = _frontend_file(path)
    if asset is not None:
        return FileResponse(asset)

    if path and Path(path).suffix:
        raise HTTPException(status_code=404, detail="Frontend asset not found")

    if not INDEX_FILE.is_file():
        raise HTTPException(
            status_code=503,
            detail="Frontend build not found. Run `npm run build` first.",
        )

    return FileResponse(INDEX_FILE)
