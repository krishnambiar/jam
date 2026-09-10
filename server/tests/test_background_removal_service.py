"""Unit tests for image validation and the rembg model adapter."""

from __future__ import annotations

import io

import pytest
from PIL import Image
from PIL.Image import Image as PILImage

from untitled_jam import preload_model as preload_module
from untitled_jam.background_removal import (
    DEFAULT_IMAGE_LIMITS,
    MODEL_NAME,
    MODEL_NAME_ENV,
    BackgroundRemovalProcessingError,
    BackgroundRemovalService,
    BackgroundRemover,
    ImageLimits,
    RembgBackgroundRemover,
    create_rembg_background_remover,
)


class PassthroughRemover:
    def remove_background(self, image: PILImage) -> PILImage:
        return image.convert("RGBA")


def make_png(size: tuple[int, int] = (5, 4)) -> bytes:
    image = Image.new("RGB", size, "purple")
    output = io.BytesIO()
    image.save(output, format="PNG")
    image.close()
    return output.getvalue()


def test_approved_default_resource_limits_are_fixed() -> None:
    assert DEFAULT_IMAGE_LIMITS == ImageLimits(
        max_input_bytes=15 * 1024 * 1024,
        max_pixels=12_500_000,
        max_axis_pixels=6_000,
        max_output_bytes=32 * 1024 * 1024,
    )


@pytest.mark.parametrize(
    "field",
    ["max_input_bytes", "max_pixels", "max_axis_pixels", "max_output_bytes"],
)
def test_resource_limits_must_be_positive(field: str) -> None:
    values = {
        "max_input_bytes": 1,
        "max_pixels": 1,
        "max_axis_pixels": 1,
        "max_output_bytes": 1,
    }
    values[field] = 0

    with pytest.raises(ValueError, match="positive"):
        ImageLimits(**values)


def test_passthrough_implements_background_remover_protocol() -> None:
    assert isinstance(PassthroughRemover(), BackgroundRemover)


def test_rembg_adapter_uses_birefnet_session_and_approved_edge_options() -> None:
    session = object()
    session_names: list[str] = []
    remove_calls: list[dict[str, object]] = []

    def session_factory(name: str) -> object:
        session_names.append(name)
        return session

    def remove_function(image: PILImage, **kwargs):
        remove_calls.append({"image": image, **kwargs})
        return image.convert("RGBA")

    remover = RembgBackgroundRemover(
        session_factory=session_factory,
        remove_function=remove_function,
    )
    source = Image.new("RGB", (3, 2), "orange")
    result = remover.remove_background(source)

    assert session_names == [MODEL_NAME]
    assert remove_calls == [
        {
            "image": source,
            "session": session,
            "alpha_matting": False,
            "post_process_mask": False,
            "decontaminate": True,
        }
    ]
    assert result.mode == "RGBA"
    result.close()
    source.close()


def test_rembg_adapter_rejects_unexpected_library_return_type() -> None:
    remover = RembgBackgroundRemover(
        session_factory=lambda _name: object(),
        remove_function=lambda _image, **_kwargs: b"not a Pillow image",
    )
    source = Image.new("RGB", (3, 2), "orange")

    with pytest.raises(TypeError, match="unexpected output type"):
        remover.remove_background(source)

    source.close()


def test_service_applies_exif_orientation_before_model_inference() -> None:
    observed_sizes: list[tuple[int, int]] = []

    class SizeRecordingRemover:
        def remove_background(self, image: PILImage) -> PILImage:
            observed_sizes.append(image.size)
            return image.convert("RGBA")

    source = Image.new("RGB", (2, 3), "green")
    exif = source.getexif()
    exif[274] = 6  # Rotate 90 degrees clockwise for display.
    encoded = io.BytesIO()
    source.save(encoded, format="JPEG", exif=exif)
    source.close()

    output = BackgroundRemovalService(SizeRecordingRemover()).process(
        encoded.getvalue(),
        "image/jpeg",
    )

    assert observed_sizes == [(3, 2)]
    assert (output.width, output.height) == (3, 2)
    with Image.open(io.BytesIO(output.png)) as result:
        assert result.size == (3, 2)


def test_production_factory_uses_default_server_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configured_names: list[str] = []

    class FakeRembgRemover:
        def __init__(self, *, model_name: str) -> None:
            configured_names.append(model_name)

        def remove_background(self, image: PILImage) -> PILImage:
            return image.convert("RGBA")

    monkeypatch.delenv(MODEL_NAME_ENV, raising=False)
    monkeypatch.setattr(
        "untitled_jam.background_removal.RembgBackgroundRemover",
        FakeRembgRemover,
    )

    remover = create_rembg_background_remover()

    assert isinstance(remover, FakeRembgRemover)
    assert configured_names == [MODEL_NAME]


def test_production_factory_reads_model_only_from_server_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configured_names: list[str] = []

    class FakeRembgRemover:
        def __init__(self, *, model_name: str) -> None:
            configured_names.append(model_name)

        def remove_background(self, image: PILImage) -> PILImage:
            return image.convert("RGBA")

    monkeypatch.setenv(MODEL_NAME_ENV, " server-selected-model ")
    monkeypatch.setattr(
        "untitled_jam.background_removal.RembgBackgroundRemover",
        FakeRembgRemover,
    )

    create_rembg_background_remover()

    assert configured_names == ["server-selected-model"]


def test_production_factory_rejects_an_empty_server_model_setting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(MODEL_NAME_ENV, "  ")

    with pytest.raises(ValueError, match=MODEL_NAME_ENV):
        create_rembg_background_remover()


def test_service_sanitizes_model_exceptions() -> None:
    class FailingRemover:
        def remove_background(self, image: PILImage) -> PILImage:
            raise RuntimeError("sensitive implementation detail")

    with pytest.raises(BackgroundRemovalProcessingError) as raised:
        BackgroundRemovalService(FailingRemover()).process(make_png(), "image/png")

    assert str(raised.value) == "The image could not be processed."
    assert raised.value.code == "processing_failed"


def test_service_rejects_model_dimension_changes() -> None:
    class ResizingRemover:
        def remove_background(self, image: PILImage) -> PILImage:
            return Image.new("RGBA", (image.width + 1, image.height))

    with pytest.raises(BackgroundRemovalProcessingError):
        BackgroundRemovalService(ResizingRemover()).process(make_png(), "image/png")


def test_preload_cli_calls_model_preloader_without_printing_payloads(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    calls = 0

    def fake_preload() -> None:
        nonlocal calls
        calls += 1

    monkeypatch.setattr(preload_module, "preload_model", fake_preload)
    preload_module.main()

    assert calls == 1
    assert capsys.readouterr().out == ""
