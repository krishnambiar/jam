"""FastAPI application that serves the Untitled Jam frontend and API."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import anyio
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response

from untitled_jam.background_removal import (
    DEFAULT_IMAGE_LIMITS,
    SUPPORTED_MEDIA_TYPES,
    BackgroundRemovalError,
    BackgroundRemovalResult,
    BackgroundRemovalService,
    BackgroundRemover,
    ImageLimits,
    ImageTooLargeError,
    create_rembg_background_remover,
)
from untitled_jam.models import ApiErrorResponse, HealthResponse

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
FRONTEND_DIST = (PROJECT_ROOT / "dist").resolve()
INDEX_FILE = FRONTEND_DIST / "index.html"
BACKGROUND_REMOVAL_PATH = "/api/images/remove-background"
BUSY_RETRY_AFTER_SECONDS = 5
IMAGE_RESPONSE_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
}

BackgroundRemoverFactory = Callable[[], BackgroundRemover]

ERROR_RESPONSES = {
    status_code: {"model": ApiErrorResponse}
    for status_code in (400, 413, 415, 422, 500, 503)
}
RAW_IMAGE_REQUEST_BODY = {
    "requestBody": {
        "required": True,
        "content": {
            media_type: {
                "schema": {
                    "type": "string",
                    "format": "binary",
                    "description": "Raw encoded image bytes.",
                }
            }
            for media_type in sorted(SUPPORTED_MEDIA_TYPES)
        },
    }
}


def _api_exception(
    status_code: int,
    code: str,
    message: str,
    *,
    headers: dict[str, str] | None = None,
) -> HTTPException:
    response_headers = {**IMAGE_RESPONSE_HEADERS, **(headers or {})}
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
        headers=response_headers,
    )


def _request_media_type(request: Request) -> str:
    media_type = (
        request.headers.get("content-type", "").partition(";")[0].strip().lower()
    )
    if media_type not in SUPPORTED_MEDIA_TYPES:
        raise _api_exception(
            415,
            "unsupported_media_type",
            "Content-Type must be image/png, image/jpeg, or image/webp.",
        )
    return media_type


async def _read_limited_body(request: Request, max_bytes: int) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared_length = int(content_length)
        except ValueError as exc:
            raise _api_exception(
                400,
                "invalid_request",
                "Content-Length must be a non-negative integer.",
            ) from exc
        if declared_length < 0:
            raise _api_exception(
                400,
                "invalid_request",
                "Content-Length must be a non-negative integer.",
            )
        if declared_length > max_bytes:
            raise ImageTooLargeError(
                f"The encoded image may not exceed {max_bytes} bytes."
            )

    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > max_bytes:
            raise ImageTooLargeError(
                f"The encoded image may not exceed {max_bytes} bytes."
            )
        body.extend(chunk)
    return bytes(body)


async def _run_background_removal(
    service: BackgroundRemovalService,
    body: bytes,
    media_type: str,
) -> BackgroundRemovalResult:
    if not service.try_acquire():
        raise _api_exception(
            503,
            "inference_busy",
            "Background removal is busy. Try again shortly.",
            headers={"Retry-After": str(BUSY_RETRY_AFTER_SECONDS)},
        )

    worker = asyncio.create_task(
        anyio.to_thread.run_sync(
            service.process,
            body,
            media_type,
            abandon_on_cancel=False,
        )
    )
    try:
        try:
            return await asyncio.shield(worker)
        except asyncio.CancelledError as cancellation:
            # asyncio Task cancellation can bypass AnyIO's thread shielding. Keep
            # consuming cancellation requests until the native worker really exits;
            # only then may another inference use this process-local session.
            while not worker.done():
                try:
                    await asyncio.shield(worker)
                except asyncio.CancelledError:
                    continue
                except Exception:
                    break
            if worker.done() and not worker.cancelled():
                worker.exception()
            raise cancellation
    finally:
        service.release()


def _http_exception_code(exc: HTTPException) -> str:
    """Extract only the stable public code from an HTTPException."""

    if isinstance(exc.detail, dict):
        code = exc.detail.get("code")
        if isinstance(code, str):
            return code
    return "request_failed"


def _log_background_removal_outcome(
    *,
    outcome: str,
    started_at: float,
    width: int | None = None,
    height: int | None = None,
    level: int = logging.INFO,
) -> None:
    """Log operational metadata without request or generated-image content."""

    logger.log(
        level,
        (
            "Background removal outcome=%s duration_ms=%.1f "
            "decoded_width=%s decoded_height=%s"
        ),
        outcome,
        (time.perf_counter() - started_at) * 1_000,
        width if width is not None else "unknown",
        height if height is not None else "unknown",
    )


def create_app(
    background_remover_factory: BackgroundRemoverFactory = create_rembg_background_remover,
    *,
    image_limits: ImageLimits = DEFAULT_IMAGE_LIMITS,
) -> FastAPI:
    """Create an app whose model lifecycle can be replaced in tests."""

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        try:
            remover = await anyio.to_thread.run_sync(
                background_remover_factory,
                abandon_on_cancel=False,
            )
        except Exception:
            logger.exception("Background-removal model failed to initialize")
            raise

        application.state.background_removal_service = BackgroundRemovalService(
            remover,
            limits=image_limits,
        )
        try:
            yield
        finally:
            application.state.background_removal_service = None

    application = FastAPI(
        title="Untitled Jam API",
        description="Python backend for the Untitled Jam whiteboard.",
        version="0.1.0",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    @application.get("/api/health", response_model=HealthResponse, tags=["system"])
    async def health() -> HealthResponse:
        """Report that the FastAPI service is ready."""

        return HealthResponse()

    @application.post(
        BACKGROUND_REMOVAL_PATH,
        response_class=Response,
        responses={
            200: {
                "content": {"image/png": {}},
                "description": "A transparent PNG containing the extracted foreground.",
            },
            **ERROR_RESPONSES,
        },
        tags=["images"],
        openapi_extra=RAW_IMAGE_REQUEST_BODY,
    )
    async def remove_image_background(request: Request) -> Response:
        """Remove the background from one raw PNG, JPEG, or WebP request body."""

        started_at = time.perf_counter()
        try:
            media_type = _request_media_type(request)
            service = getattr(
                request.app.state,
                "background_removal_service",
                None,
            )
            if service is None:
                raise _api_exception(
                    503,
                    "model_unavailable",
                    "Background removal is unavailable.",
                )

            body = await _read_limited_body(request, service.limits.max_input_bytes)
            result = await _run_background_removal(service, body, media_type)
        except BackgroundRemovalError as exc:
            _log_background_removal_outcome(
                outcome=exc.code,
                started_at=started_at,
                width=exc.width,
                height=exc.height,
                level=logging.ERROR if exc.status_code >= 500 else logging.INFO,
            )
            raise _api_exception(exc.status_code, exc.code, exc.message) from exc
        except HTTPException as exc:
            _log_background_removal_outcome(
                outcome=_http_exception_code(exc),
                started_at=started_at,
                level=logging.ERROR if exc.status_code >= 500 else logging.INFO,
            )
            raise
        except Exception as exc:
            _log_background_removal_outcome(
                outcome="processing_failed",
                started_at=started_at,
                level=logging.ERROR,
            )
            raise _api_exception(
                500,
                "processing_failed",
                "The image could not be processed.",
            ) from exc

        _log_background_removal_outcome(
            outcome="success",
            started_at=started_at,
            width=result.width,
            height=result.height,
        )
        return Response(
            content=result.png,
            media_type="image/png",
            headers=IMAGE_RESPONSE_HEADERS,
        )

    @application.get("/{path:path}", include_in_schema=False, response_model=None)
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

    return application


def _frontend_file(path: str) -> Optional[Path]:
    """Resolve a requested frontend asset without allowing path traversal."""

    candidate = (FRONTEND_DIST / path).resolve()
    try:
        candidate.relative_to(FRONTEND_DIST)
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


app = create_app()
