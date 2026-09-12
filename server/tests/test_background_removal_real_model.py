"""Opt-in end-to-end smoke test for the downloaded BiRefNet model."""

from __future__ import annotations

import io
import os

import pytest
from PIL import Image, ImageDraw

from untitled_jam.background_removal import (
    BackgroundRemovalService,
    RembgBackgroundRemover,
)


@pytest.mark.real_model
def test_real_birefnet_model_produces_an_rgba_png() -> None:
    if os.environ.get("RUN_REAL_BACKGROUND_REMOVAL_TEST") != "1":
        pytest.skip("set RUN_REAL_BACKGROUND_REMOVAL_TEST=1 after preloading the model")

    source = Image.new("RGB", (128, 96), "white")
    drawing = ImageDraw.Draw(source)
    drawing.ellipse((32, 16, 96, 80), fill="navy")
    encoded = io.BytesIO()
    source.save(encoded, format="PNG")
    source.close()

    output = BackgroundRemovalService(RembgBackgroundRemover()).process(
        encoded.getvalue(),
        "image/png",
    )

    assert (output.width, output.height) == (128, 96)
    with Image.open(io.BytesIO(output.png)) as result:
        assert result.format == "PNG"
        assert result.mode == "RGBA"
        assert result.size == (128, 96)
        alpha = result.getchannel("A")
        try:
            minimum_alpha, maximum_alpha = alpha.getextrema()
            assert minimum_alpha < 64
            assert maximum_alpha > 192

            background = [
                alpha.getpixel((x, y))
                for y in range(result.height)
                for x in range(result.width)
                if x < 16 or x >= 112 or y < 16 or y >= 80
            ]
            subject = [
                alpha.getpixel((x, y)) for y in range(32, 64) for x in range(48, 80)
            ]
            assert sum(value < 64 for value in background) / len(background) > 0.6
            assert sum(value > 192 for value in subject) / len(subject) > 0.6
        finally:
            alpha.close()
