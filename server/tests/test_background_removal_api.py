"""HTTP contract tests for background removal using lightweight fakes."""

from __future__ import annotations

import asyncio
import io
import logging
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from PIL import Image, features
from PIL.Image import Image as PILImage

from untitled_jam.background_removal import BackgroundRemovalService, ImageLimits
from untitled_jam.main import (
    BACKGROUND_REMOVAL_PATH,
    _run_background_removal,
    create_app,
)


class RecordingRemover:
    def __init__(self) -> None:
        self.calls: list[tuple[tuple[int, int], str]] = []

    def remove_background(self, image: PILImage) -> PILImage:
        self.calls.append((image.size, image.mode))
        return image.convert("RGBA")


class BlockingRemover(RecordingRemover):
    def __init__(self) -> None:
        super().__init__()
        self.started = threading.Event()
        self.release = threading.Event()

    def remove_background(self, image: PILImage) -> PILImage:
        self.started.set()
        if not self.release.wait(timeout=5):
            raise TimeoutError("test did not release the fake inference")
        return super().remove_background(image)


class FailOnceRemover(RecordingRemover):
    def __init__(self) -> None:
        super().__init__()
        self.failed = False

    def remove_background(self, image: PILImage) -> PILImage:
        if not self.failed:
            self.failed = True
            raise RuntimeError("private model failure detail")
        return super().remove_background(image)


def make_image_bytes(
    image_format: str = "PNG",
    *,
    size: tuple[int, int] = (8, 6),
    color: tuple[int, int, int] = (34, 120, 210),
) -> bytes:
    image = Image.new("RGB", size, color)
    output = io.BytesIO()
    image.save(output, format=image_format)
    image.close()
    return output.getvalue()


def error_code(response) -> str:
    return response.json()["detail"]["code"]


def test_openapi_describes_the_raw_supported_image_bodies() -> None:
    with TestClient(create_app(RecordingRemover)) as client:
        operation = client.get("/api/openapi.json").json()["paths"][
            BACKGROUND_REMOVAL_PATH
        ]["post"]

    request_body = operation["requestBody"]
    assert request_body["required"] is True
    assert set(request_body["content"]) == {
        "image/jpeg",
        "image/png",
        "image/webp",
    }
    for representation in request_body["content"].values():
        assert representation["schema"]["type"] == "string"
        assert representation["schema"]["format"] == "binary"


@pytest.mark.parametrize(
    ("image_format", "media_type"),
    [
        ("PNG", "image/png"),
        ("JPEG", "image/jpeg"),
        ("WEBP", "image/webp"),
    ],
)
def test_success_returns_uncacheable_rgba_png(
    image_format: str,
    media_type: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    remover = RecordingRemover()
    with caplog.at_level(logging.INFO):
        with TestClient(create_app(lambda: remover)) as client:
            response = client.post(
                BACKGROUND_REMOVAL_PATH,
                content=make_image_bytes(image_format),
                headers={"Content-Type": media_type},
            )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    with Image.open(io.BytesIO(response.content)) as output:
        assert output.format == "PNG"
        assert output.mode == "RGBA"
        assert output.size == (8, 6)
    assert remover.calls == [((8, 6), "RGB")]
    assert "outcome=success" in caplog.text
    assert "duration_ms=" in caplog.text
    assert "decoded_width=8" in caplog.text
    assert "decoded_height=6" in caplog.text
    assert "input_bytes" not in caplog.text
    assert "output_bytes" not in caplog.text


def test_query_parameters_cannot_select_the_model() -> None:
    remover = RecordingRemover()
    with TestClient(create_app(lambda: remover)) as client:
        response = client.post(
            f"{BACKGROUND_REMOVAL_PATH}?model=u2net",
            content=make_image_bytes(),
            headers={"Content-Type": "image/png"},
        )

    assert response.status_code == 200
    assert remover.calls == [((8, 6), "RGB")]


def test_existing_png_transparency_is_preserved_by_the_pipeline() -> None:
    source = Image.new("RGBA", (4, 3), (20, 40, 60, 255))
    source.putpixel((0, 0), (20, 40, 60, 0))
    source.putpixel((1, 0), (20, 40, 60, 128))
    encoded = io.BytesIO()
    source.save(encoded, format="PNG")
    source.close()

    class OpaqueRemover(RecordingRemover):
        def remove_background(self, image: PILImage) -> PILImage:
            self.calls.append((image.size, image.mode))
            return Image.new("RGBA", image.size, (200, 100, 50, 255))

    remover = OpaqueRemover()
    with TestClient(create_app(lambda: remover)) as client:
        response = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=encoded.getvalue(),
            headers={"Content-Type": "image/png"},
        )

    assert response.status_code == 200
    with Image.open(io.BytesIO(response.content)) as output:
        assert output.mode == "RGBA"
        assert output.size == (4, 3)
        assert output.getpixel((0, 0))[3] == 0
        assert output.getpixel((1, 0))[3] == 128
        assert output.getpixel((1, 1))[3] == 255
    assert remover.calls == [((4, 3), "RGBA")]


@pytest.mark.parametrize("media_type", [None, "", "text/plain", "image/gif"])
def test_request_requires_a_supported_content_type(media_type: str | None) -> None:
    headers = {} if media_type is None else {"Content-Type": media_type}
    with TestClient(create_app(RecordingRemover)) as client:
        response = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=make_image_bytes(),
            headers=headers,
        )

    assert response.status_code == 415
    assert error_code(response) == "unsupported_media_type"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_content_type_parameters_and_case_are_normalized() -> None:
    with TestClient(create_app(RecordingRemover)) as client:
        response = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=make_image_bytes(),
            headers={"Content-Type": "IMAGE/PNG; charset=binary"},
        )

    assert response.status_code == 200


def test_decoded_format_must_match_the_declared_content_type() -> None:
    with TestClient(create_app(RecordingRemover)) as client:
        response = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=make_image_bytes("JPEG"),
            headers={"Content-Type": "image/png"},
        )

    assert response.status_code == 422
    assert error_code(response) == "content_type_mismatch"


def test_valid_but_unsupported_decoded_format_is_rejected() -> None:
    with TestClient(create_app(RecordingRemover)) as client:
        response = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=make_image_bytes("GIF"),
            headers={"Content-Type": "image/png"},
        )

    assert response.status_code == 415
    assert error_code(response) == "unsupported_image_type"


@pytest.mark.parametrize("body", [b"", b"not an image"])
def test_empty_or_unidentifiable_image_is_rejected(body: bytes) -> None:
    with TestClient(create_app(RecordingRemover)) as client:
        response = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=body,
            headers={"Content-Type": "image/png"},
        )

    assert response.status_code == 422
    assert error_code(response) == "invalid_image"


def test_truncated_image_is_rejected() -> None:
    jpeg = make_image_bytes("JPEG", size=(64, 64))
    with TestClient(create_app(RecordingRemover)) as client:
        response = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=jpeg[: len(jpeg) // 2],
            headers={"Content-Type": "image/jpeg"},
        )

    assert response.status_code == 422
    assert error_code(response) == "invalid_image"


@pytest.mark.skipif(not features.check("webp"), reason="Pillow lacks WebP support")
def test_animated_webp_is_rejected() -> None:
    first = Image.new("RGB", (8, 8), "red")
    second = Image.new("RGB", (8, 8), "blue")
    output = io.BytesIO()
    first.save(
        output,
        format="WEBP",
        save_all=True,
        append_images=[second],
        duration=100,
        loop=0,
    )
    first.close()
    second.close()

    with TestClient(create_app(RecordingRemover)) as client:
        response = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=output.getvalue(),
            headers={"Content-Type": "image/webp"},
        )

    assert response.status_code == 422
    assert error_code(response) == "animated_image_unsupported"


def test_input_byte_limit_accepts_exact_limit_and_rejects_one_more() -> None:
    png = make_image_bytes()
    limit = len(png) + 5
    limits = ImageLimits(
        max_input_bytes=limit,
        max_pixels=1_000,
        max_axis_pixels=100,
        max_output_bytes=10_000,
    )
    with TestClient(create_app(RecordingRemover, image_limits=limits)) as client:
        exact = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=png + (b"\0" * 5),
            headers={"Content-Type": "image/png"},
        )
        too_large = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=png + (b"\0" * 6),
            headers={"Content-Type": "image/png"},
        )

    assert exact.status_code == 200
    assert too_large.status_code == 413
    assert error_code(too_large) == "image_too_large"


def test_streamed_body_is_measured_when_content_length_is_absent() -> None:
    png = make_image_bytes()
    limits = ImageLimits(
        max_input_bytes=len(png) - 1,
        max_pixels=1_000,
        max_axis_pixels=100,
        max_output_bytes=10_000,
    )

    def chunks():
        yield png[:10]
        yield png[10:]

    with TestClient(create_app(RecordingRemover, image_limits=limits)) as client:
        response = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=chunks(),
            headers={"Content-Type": "image/png"},
        )

    assert response.status_code == 413
    assert error_code(response) == "image_too_large"


def test_pixel_limit_accepts_exact_limit_and_rejects_one_more() -> None:
    limits = ImageLimits(
        max_input_bytes=10_000,
        max_pixels=12,
        max_axis_pixels=10,
        max_output_bytes=10_000,
    )
    with TestClient(create_app(RecordingRemover, image_limits=limits)) as client:
        exact = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=make_image_bytes(size=(4, 3)),
            headers={"Content-Type": "image/png"},
        )
        too_large = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=make_image_bytes(size=(4, 4)),
            headers={"Content-Type": "image/png"},
        )

    assert exact.status_code == 200
    assert too_large.status_code == 413
    assert error_code(too_large) == "image_too_large"


def test_axis_limit_accepts_exact_limit_and_rejects_one_more() -> None:
    limits = ImageLimits(
        max_input_bytes=10_000,
        max_pixels=100,
        max_axis_pixels=4,
        max_output_bytes=10_000,
    )
    with TestClient(create_app(RecordingRemover, image_limits=limits)) as client:
        exact = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=make_image_bytes(size=(4, 2)),
            headers={"Content-Type": "image/png"},
        )
        too_large = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=make_image_bytes(size=(5, 2)),
            headers={"Content-Type": "image/png"},
        )

    assert exact.status_code == 200
    assert too_large.status_code == 413
    assert error_code(too_large) == "image_too_large"


def test_output_byte_limit_accepts_exact_limit_and_rejects_one_less() -> None:
    body = make_image_bytes(size=(12, 10))
    generous_limits = ImageLimits(
        max_input_bytes=10_000,
        max_pixels=1_000,
        max_axis_pixels=100,
        max_output_bytes=10_000,
    )
    with TestClient(
        create_app(RecordingRemover, image_limits=generous_limits)
    ) as client:
        baseline = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=body,
            headers={"Content-Type": "image/png"},
        )

    exact_limit = ImageLimits(
        max_input_bytes=10_000,
        max_pixels=1_000,
        max_axis_pixels=100,
        max_output_bytes=len(baseline.content),
    )
    below_limit = ImageLimits(
        max_input_bytes=10_000,
        max_pixels=1_000,
        max_axis_pixels=100,
        max_output_bytes=len(baseline.content) - 1,
    )
    with TestClient(create_app(RecordingRemover, image_limits=exact_limit)) as client:
        exact = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=body,
            headers={"Content-Type": "image/png"},
        )
    with TestClient(create_app(RecordingRemover, image_limits=below_limit)) as client:
        too_large = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=body,
            headers={"Content-Type": "image/png"},
        )

    assert baseline.status_code == 200
    assert exact.status_code == 200
    assert too_large.status_code == 413
    assert error_code(too_large) == "output_too_large"


def test_busy_service_rejects_immediately_without_queueing() -> None:
    remover = BlockingRemover()
    body = make_image_bytes()
    with TestClient(create_app(lambda: remover)) as client:
        with ThreadPoolExecutor(max_workers=1) as executor:
            first_future = executor.submit(
                client.post,
                BACKGROUND_REMOVAL_PATH,
                content=body,
                headers={"Content-Type": "image/png"},
            )
            assert remover.started.wait(timeout=2)

            busy = client.post(
                BACKGROUND_REMOVAL_PATH,
                content=body,
                headers={"Content-Type": "image/png"},
            )
            remover.release.set()
            first = first_future.result(timeout=5)

    assert first.status_code == 200
    assert busy.status_code == 503
    assert busy.headers["retry-after"] == "5"
    assert error_code(busy) == "inference_busy"
    assert len(remover.calls) == 1


def test_slot_is_released_after_processing_failure(
    caplog: pytest.LogCaptureFixture,
) -> None:
    remover = FailOnceRemover()
    body = make_image_bytes()
    with caplog.at_level(logging.ERROR):
        with TestClient(create_app(lambda: remover)) as client:
            failed = client.post(
                BACKGROUND_REMOVAL_PATH,
                content=body,
                headers={"Content-Type": "image/png"},
            )
            recovered = client.post(
                BACKGROUND_REMOVAL_PATH,
                content=body,
                headers={"Content-Type": "image/png"},
            )

    assert failed.status_code == 500
    assert error_code(failed) == "processing_failed"
    assert "private model failure detail" not in caplog.text
    assert recovered.status_code == 200


def test_cancelled_waiter_keeps_slot_until_worker_finishes() -> None:
    remover = BlockingRemover()
    service = BackgroundRemovalService(remover)
    body = make_image_bytes()

    async def scenario() -> None:
        task = asyncio.create_task(_run_background_removal(service, body, "image/png"))
        started = await asyncio.to_thread(remover.started.wait, 2)
        assert started
        task.cancel()
        await asyncio.sleep(0.05)

        acquired_while_running = service.try_acquire()
        if acquired_while_running:
            service.release()
        assert not acquired_while_running

        remover.release.set()
        with pytest.raises(asyncio.CancelledError):
            await task

        assert service.try_acquire()
        service.release()

    asyncio.run(scenario())


def test_lifespan_constructs_one_shared_remover() -> None:
    remover = RecordingRemover()
    factory_calls = 0

    def factory() -> RecordingRemover:
        nonlocal factory_calls
        factory_calls += 1
        return remover

    with TestClient(create_app(factory)) as client:
        for _ in range(2):
            response = client.post(
                BACKGROUND_REMOVAL_PATH,
                content=make_image_bytes(),
                headers={"Content-Type": "image/png"},
            )
            assert response.status_code == 200

    assert factory_calls == 1
    assert len(remover.calls) == 2


def test_endpoint_is_unavailable_when_lifespan_has_not_run() -> None:
    client = TestClient(create_app(RecordingRemover))
    try:
        response = client.post(
            BACKGROUND_REMOVAL_PATH,
            content=make_image_bytes(),
            headers={"Content-Type": "image/png"},
        )
    finally:
        client.close()

    assert response.status_code == 503
    assert error_code(response) == "model_unavailable"
