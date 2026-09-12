"""Background-removal service, validation, and rembg integration."""

from __future__ import annotations

import io
import logging
import os
import threading
import warnings
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from PIL import Image, ImageChops, ImageOps, UnidentifiedImageError
from PIL.Image import Image as PILImage

logger = logging.getLogger(__name__)

MODEL_NAME = "birefnet-general"
MODEL_NAME_ENV = "UNTITLED_JAM_BACKGROUND_REMOVAL_MODEL"
SUPPORTED_MEDIA_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
MEDIA_TYPE_FORMATS = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WEBP",
}


@dataclass(frozen=True, slots=True)
class ImageLimits:
    """Resource limits applied to one background-removal request."""

    max_input_bytes: int = 15 * 1024 * 1024
    max_pixels: int = 12_500_000
    max_axis_pixels: int = 6_000
    max_output_bytes: int = 32 * 1024 * 1024

    def __post_init__(self) -> None:
        if (
            min(
                self.max_input_bytes,
                self.max_pixels,
                self.max_axis_pixels,
                self.max_output_bytes,
            )
            <= 0
        ):
            raise ValueError("Image limits must all be positive.")


DEFAULT_IMAGE_LIMITS = ImageLimits()


@dataclass(frozen=True, slots=True)
class BackgroundRemovalResult:
    """Encoded output plus non-sensitive metadata used for response logging."""

    png: bytes
    width: int
    height: int


class BackgroundRemovalError(Exception):
    """Base class for failures with a stable public API representation."""

    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.width: int | None = None
        self.height: int | None = None

    def attach_dimensions(self, dimensions: tuple[int, int] | None) -> None:
        if dimensions is not None and self.width is None and self.height is None:
            self.width, self.height = dimensions


class InvalidImageError(BackgroundRemovalError):
    def __init__(
        self,
        message: str = "The request body is not a valid supported image.",
        *,
        code: str = "invalid_image",
    ) -> None:
        super().__init__(code, message, 422)


class UnsupportedImageTypeError(BackgroundRemovalError):
    def __init__(self) -> None:
        super().__init__(
            "unsupported_image_type",
            "The decoded image must be PNG, JPEG, or WebP.",
            415,
        )


class ImageTooLargeError(BackgroundRemovalError):
    def __init__(self, message: str) -> None:
        super().__init__("image_too_large", message, 413)


class OutputTooLargeError(BackgroundRemovalError):
    def __init__(self, max_output_bytes: int) -> None:
        super().__init__(
            "output_too_large",
            f"The processed PNG exceeds the {max_output_bytes} byte output limit.",
            413,
        )


class BackgroundRemovalProcessingError(BackgroundRemovalError):
    def __init__(self) -> None:
        super().__init__(
            "processing_failed",
            "The image could not be processed.",
            500,
        )


@runtime_checkable
class BackgroundRemover(Protocol):
    """Model adapter used by the application-level image pipeline."""

    def remove_background(self, image: PILImage) -> PILImage:
        """Return an image with its background represented as transparency."""


class RembgBackgroundRemover:
    """BiRefNet implementation backed by one reusable rembg session."""

    def __init__(
        self,
        *,
        model_name: str = MODEL_NAME,
        session_factory: Callable[[str], Any] | None = None,
        remove_function: Callable[..., Any] | None = None,
    ) -> None:
        if session_factory is None or remove_function is None:
            from rembg import new_session, remove

            session_factory = session_factory or new_session
            remove_function = remove_function or remove

        logger.info("Loading background-removal model %s", model_name)
        self._session = session_factory(model_name)
        self._remove = remove_function
        self.model_name = model_name
        logger.info("Background-removal model is ready")

    def remove_background(self, image: PILImage) -> PILImage:
        output = self._remove(
            image,
            session=self._session,
            alpha_matting=False,
            post_process_mask=False,
            decontaminate=True,
        )
        if not isinstance(output, PILImage):
            raise TypeError("rembg returned an unexpected output type")
        return output


class _LimitedBytesIO(io.BytesIO):
    """Bytes buffer that refuses to grow beyond a configured high-water mark."""

    def __init__(self, limit: int) -> None:
        super().__init__()
        self._limit = limit
        self._high_water_mark = 0

    def write(self, data: bytes | bytearray) -> int:
        next_high_water_mark = max(self._high_water_mark, self.tell() + len(data))
        if next_high_water_mark > self._limit:
            raise OutputTooLargeError(self._limit)
        written = super().write(data)
        self._high_water_mark = next_high_water_mark
        return written


def _decode_image(
    data: bytes,
    declared_media_type: str,
    limits: ImageLimits,
) -> PILImage:
    expected_format = MEDIA_TYPE_FORMATS[declared_media_type]

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            source = Image.open(io.BytesIO(data))
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise ImageTooLargeError("The decoded image dimensions are too large.") from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise InvalidImageError() from exc

    try:
        actual_format = (source.format or "").upper()
        if actual_format not in MEDIA_TYPE_FORMATS.values():
            error = UnsupportedImageTypeError()
            error.attach_dimensions(source.size)
            raise error
        if actual_format != expected_format:
            error = InvalidImageError(
                "The request Content-Type does not match the decoded image.",
                code="content_type_mismatch",
            )
            error.attach_dimensions(source.size)
            raise error

        width, height = source.size
        if width <= 0 or height <= 0:
            raise InvalidImageError("The image has no visible dimensions.")
        if width > limits.max_axis_pixels or height > limits.max_axis_pixels:
            error = ImageTooLargeError(
                f"Neither image dimension may exceed {limits.max_axis_pixels} pixels."
            )
            error.attach_dimensions((width, height))
            raise error
        if width * height > limits.max_pixels:
            error = ImageTooLargeError(
                f"The image may contain at most {limits.max_pixels} pixels."
            )
            error.attach_dimensions((width, height))
            raise error
        if getattr(source, "n_frames", 1) > 1:
            error = InvalidImageError(
                "Animated images are not supported.",
                code="animated_image_unsupported",
            )
            error.attach_dimensions((width, height))
            raise error

        try:
            source.load()
            oriented = ImageOps.exif_transpose(source)
            try:
                oriented.load()
                return oriented.copy()
            finally:
                if oriented is not source:
                    oriented.close()
        except (OSError, SyntaxError, ValueError) as exc:
            error = InvalidImageError()
            error.attach_dimensions((width, height))
            raise error from exc
    finally:
        source.close()


def _encode_png(image: PILImage, max_output_bytes: int) -> bytes:
    buffer = _LimitedBytesIO(max_output_bytes)
    rgba_image = image if image.mode == "RGBA" else image.convert("RGBA")
    try:
        rgba_image.save(buffer, format="PNG", compress_level=6)
        return buffer.getvalue()
    finally:
        if rgba_image is not image:
            rgba_image.close()
        buffer.close()


def _preserve_source_transparency(
    source: PILImage,
    processed: PILImage,
) -> PILImage:
    """Intersect model alpha with any transparency already present in the source."""

    if "A" in source.getbands():
        source_alpha = source.getchannel("A")
    elif "transparency" in source.info:
        rgba_source = source.convert("RGBA")
        try:
            source_alpha = rgba_source.getchannel("A")
        finally:
            rgba_source.close()
    else:
        return processed

    try:
        if source_alpha.getextrema() == (255, 255):
            return processed

        rgba_processed = (
            processed.copy() if processed.mode == "RGBA" else processed.convert("RGBA")
        )
        try:
            processed_alpha = rgba_processed.getchannel("A")
            try:
                combined_alpha = ImageChops.multiply(processed_alpha, source_alpha)
                try:
                    rgba_processed.putalpha(combined_alpha)
                finally:
                    combined_alpha.close()
            finally:
                processed_alpha.close()
            return rgba_processed
        except Exception:
            rgba_processed.close()
            raise
    finally:
        source_alpha.close()


class BackgroundRemovalService:
    """Validates images and serializes one inference per process without queuing."""

    def __init__(
        self,
        remover: BackgroundRemover,
        *,
        limits: ImageLimits = DEFAULT_IMAGE_LIMITS,
    ) -> None:
        self._remover = remover
        self.limits = limits
        self._inference_slot = threading.BoundedSemaphore(value=1)

    def try_acquire(self) -> bool:
        """Reserve the process-local inference slot without waiting."""

        return self._inference_slot.acquire(blocking=False)

    def release(self) -> None:
        """Release a previously reserved inference slot."""

        self._inference_slot.release()

    def process(self, data: bytes, declared_media_type: str) -> BackgroundRemovalResult:
        """Run the complete synchronous decode, inference, and encode pipeline."""

        input_image: PILImage | None = None
        output_image: PILImage | None = None
        input_size: tuple[int, int] | None = None
        try:
            input_image = _decode_image(data, declared_media_type, self.limits)
            input_size = input_image.size
            output_image = self._remover.remove_background(input_image)
            if output_image.size != input_size:
                raise ValueError("The model changed the image dimensions")
            output_image.load()
            alpha_preserved_output = _preserve_source_transparency(
                input_image,
                output_image,
            )
            if alpha_preserved_output is not output_image:
                if output_image is not input_image:
                    output_image.close()
                output_image = alpha_preserved_output
            return BackgroundRemovalResult(
                png=_encode_png(output_image, self.limits.max_output_bytes),
                width=input_size[0],
                height=input_size[1],
            )
        except BackgroundRemovalError as exc:
            exc.attach_dimensions(input_size)
            raise
        except Exception as exc:
            error = BackgroundRemovalProcessingError()
            error.attach_dimensions(input_size)
            raise error from exc
        finally:
            if output_image is not None and output_image is not input_image:
                output_image.close()
            if input_image is not None:
                input_image.close()


def create_rembg_background_remover() -> BackgroundRemover:
    """Production factory used by the FastAPI lifespan and preload command."""

    model_name = os.environ.get(MODEL_NAME_ENV, MODEL_NAME).strip()
    if not model_name:
        raise ValueError(f"{MODEL_NAME_ENV} may not be empty")
    return RembgBackgroundRemover(model_name=model_name)


def preload_model() -> None:
    """Download, checksum, and load the configured model, then exit."""

    create_rembg_background_remover()
    logger.info("Background-removal model preload completed")
