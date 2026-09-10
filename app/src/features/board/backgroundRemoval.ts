import type { CanvasImage } from './types';

export const BACKGROUND_REMOVAL_ENABLED =
  import.meta.env.VITE_BACKGROUND_REMOVAL_ENABLED === 'true';

const BACKGROUND_REMOVAL_ENDPOINT = '/api/images/remove-background';
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const decodeDataUrl = globalThis.fetch.bind(globalThis);

export type BackgroundRemovalErrorCategory =
  | 'aborted'
  | 'image-too-large'
  | 'invalid-image'
  | 'invalid-response'
  | 'network-error'
  | 'processing-failed'
  | 'service-busy'
  | 'service-unavailable'
  | 'unsupported-image';

const ERROR_MESSAGES: Record<BackgroundRemovalErrorCategory, string> = {
  aborted: 'Background removal was canceled.',
  'image-too-large': 'That image is too large to remove its background.',
  'invalid-image': 'That image could not be processed.',
  'invalid-response':
    'Background removal returned an invalid image. Please try again.',
  'network-error':
    'Could not reach background removal. Check your connection and try again.',
  'processing-failed':
    'The image background could not be removed. Please try again.',
  'service-busy': 'Background removal is busy. Please try again in a moment.',
  'service-unavailable':
    'Background removal is unavailable right now. Please try again later.',
  'unsupported-image':
    'Background removal supports PNG, JPEG, and WebP images.',
};

type BackgroundRemovalErrorOptions = {
  cause?: unknown;
  retryAfterSeconds?: number;
};

export class BackgroundRemovalError extends Error {
  readonly category: BackgroundRemovalErrorCategory;
  readonly retryAfterSeconds?: number;

  constructor(
    category: BackgroundRemovalErrorCategory,
    options: BackgroundRemovalErrorOptions = {},
  ) {
    super(ERROR_MESSAGES[category], { cause: options.cause });
    this.name = 'BackgroundRemovalError';
    this.category = category;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function activeImageSource(
  image: CanvasImage,
  backgroundRemovalEnabled = BACKGROUND_REMOVAL_ENABLED,
) {
  return backgroundRemovalEnabled &&
    image.backgroundRemoved === true &&
    image.backgroundRemovedSrc
    ? image.backgroundRemovedSrc
    : image.src;
}

export async function imageDataUrlToBlob(
  src: string,
  signal?: AbortSignal,
) {
  if (!src.startsWith('data:')) {
    throw new BackgroundRemovalError('invalid-image');
  }

  const commaIndex = src.indexOf(',');
  if (commaIndex < 0) {
    throw new BackgroundRemovalError('invalid-image');
  }

  const metadata = src.slice('data:'.length, commaIndex).split(';');
  const mediaType = metadata.shift()?.trim().toLowerCase() ?? '';
  const isBase64 = metadata.some(
    (parameter) => parameter.trim().toLowerCase() === 'base64',
  );

  if (!SUPPORTED_IMAGE_TYPES.has(mediaType)) {
    throw new BackgroundRemovalError('unsupported-image');
  }
  if (!isBase64) {
    throw new BackgroundRemovalError('invalid-image');
  }

  const encoded = src.slice(commaIndex + 1);
  if (encoded.length === 0) {
    throw new BackgroundRemovalError('invalid-image');
  }
  // Standard base64 expands three bytes to four characters. This conservative
  // preflight avoids asking the browser to allocate an over-limit payload.
  if (encoded.length > Math.ceil(MAX_INPUT_BYTES / 3) * 4) {
    throw new BackgroundRemovalError('image-too-large');
  }

  try {
    // Let the browser's native data-URL loader do the potentially large decode
    // asynchronously instead of copying every byte in JavaScript.
    const response = await decodeDataUrl(src, { signal });
    if (!response.ok) throw new Error('Data URL could not be decoded');
    const blob = await response.blob();
    if (blob.size === 0) throw new Error('Decoded image is empty');
    if (blob.size > MAX_INPUT_BYTES) {
      throw new BackgroundRemovalError('image-too-large');
    }
    return blob.type === mediaType
      ? blob
      : new Blob([blob], { type: mediaType });
  } catch (error) {
    if (error instanceof BackgroundRemovalError) throw error;
    if (signal?.aborted || isAbortError(error)) {
      throw new BackgroundRemovalError('aborted', { cause: error });
    }
    throw new BackgroundRemovalError('invalid-image', { cause: error });
  }
}

function retryAfterSeconds(response: Response) {
  const rawValue = response.headers.get('retry-after');
  if (!rawValue) return undefined;

  const seconds = Number(rawValue);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const date = Date.parse(rawValue);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

async function serverErrorCode(response: Response) {
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return null;

    const detail = (body as Record<string, unknown>).detail;
    if (!detail || typeof detail !== 'object') return null;

    const code = (detail as Record<string, unknown>).code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

async function errorForResponse(response: Response) {
  const code = await serverErrorCode(response);

  if (response.status === 413 || code === 'image_too_large') {
    return new BackgroundRemovalError('image-too-large');
  }
  if (response.status === 415 || code === 'unsupported_media_type') {
    return new BackgroundRemovalError('unsupported-image');
  }
  if (
    response.status === 422 ||
    code === 'invalid_image' ||
    code === 'animated_image_unsupported'
  ) {
    return new BackgroundRemovalError('invalid-image');
  }
  if (response.status === 429 || code === 'inference_busy') {
    return new BackgroundRemovalError('service-busy', {
      retryAfterSeconds: retryAfterSeconds(response),
    });
  }
  if (response.status === 503 || code === 'model_unavailable') {
    return new BackgroundRemovalError('service-unavailable');
  }
  if (response.status >= 500 || code === 'processing_failed') {
    return new BackgroundRemovalError('processing-failed');
  }
  return new BackgroundRemovalError('service-unavailable');
}

function pngDimensions(bytes: Uint8Array) {
  if (
    bytes.byteLength < 45 ||
    !PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  ) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset: number = PNG_SIGNATURE.length;
  let sawHeader = false;
  let sawImageData = false;
  let dimensions: { width: number; height: number } | null = null;

  while (offset <= bytes.byteLength - 12) {
    const length = view.getUint32(offset);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + length + 4;
    if (nextOffset > bytes.byteLength) return null;

    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );

    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) return null;
      const width = view.getUint32(dataOffset);
      const height = view.getUint32(dataOffset + 4);
      const bitDepth = bytes[dataOffset + 8];
      const colorType = bytes[dataOffset + 9];
      const compression = bytes[dataOffset + 10];
      const filter = bytes[dataOffset + 11];
      const interlace = bytes[dataOffset + 12];
      if (
        width === 0 ||
        height === 0 ||
        bitDepth !== 8 ||
        colorType !== 6 ||
        compression !== 0 ||
        filter !== 0 ||
        (interlace !== 0 && interlace !== 1)
      ) {
        return null;
      }
      sawHeader = true;
      dimensions = { width, height };
    } else if (type === 'IHDR') {
      return null;
    }

    if (type === 'IDAT') sawImageData = true;
    if (type === 'IEND') {
      return length === 0 && sawImageData && nextOffset === bytes.byteLength
        ? dimensions
        : null;
    }
    offset = nextOffset;
  }

  return null;
}

async function verifyBrowserCanDecodePng(
  blob: Blob,
  expected: { width: number; height: number },
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(blob);
      if (bitmap.width !== expected.width || bitmap.height !== expected.height) {
        throw new Error('Decoded PNG dimensions do not match its header');
      }
      return;
    } finally {
      bitmap?.close();
    }
  }

  if (
    typeof Image === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof URL.revokeObjectURL !== 'function'
  ) {
    // Non-browser unit-test runtimes cannot raster-decode; structural checks
    // above still reject truncated responses. Real supported browsers take one
    // of the decode paths.
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      URL.revokeObjectURL(objectUrl);
    };
    const onAbort = () => {
      image.src = '';
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    image.onload = () => {
      const valid =
        image.naturalWidth === expected.width &&
        image.naturalHeight === expected.height;
      cleanup();
      if (valid) resolve();
      else reject(new Error('Decoded PNG dimensions do not match its header'));
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('PNG could not be decoded'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    image.src = objectUrl;
  });
}

function blobToDataUrl(blob: Blob, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (reader.readyState === FileReader.LOADING) {
        reader.abort();
        return;
      }
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    reader.onload = () => {
      cleanup();
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('PNG encoding failed'));
    };
    reader.onerror = () => {
      cleanup();
      reject(reader.error ?? new Error('PNG encoding failed'));
    };
    reader.onabort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    reader.readAsDataURL(blob);
  });
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException
      ? error.name === 'AbortError'
      : Boolean(
          error &&
            typeof error === 'object' &&
            'name' in error &&
            error.name === 'AbortError',
        )
  );
}

export async function removeImageBackground(
  src: string,
  signal?: AbortSignal,
) {
  try {
    const image = await imageDataUrlToBlob(src, signal);
    const response = await fetch(BACKGROUND_REMOVAL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': image.type },
      body: image,
      signal,
    });

    if (!response.ok) throw await errorForResponse(response);

    const mediaType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (mediaType !== 'image/png') {
      throw new BackgroundRemovalError('invalid-response');
    }

    const output = await response.blob();
    if (output.size === 0 || output.size > MAX_OUTPUT_BYTES) {
      throw new BackgroundRemovalError('invalid-response');
    }
    const bytes = new Uint8Array(await output.arrayBuffer());
    const dimensions = pngDimensions(bytes);
    if (!dimensions) {
      throw new BackgroundRemovalError('invalid-response');
    }
    try {
      await verifyBrowserCanDecodePng(output, dimensions, signal);
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;
      throw new BackgroundRemovalError('invalid-response', { cause: error });
    }

    let dataUrl: string;
    try {
      dataUrl = await blobToDataUrl(output, signal);
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;
      throw new BackgroundRemovalError('invalid-response', { cause: error });
    }
    if (!dataUrl.startsWith('data:image/png;base64,')) {
      throw new BackgroundRemovalError('invalid-response');
    }
    return dataUrl;
  } catch (error) {
    if (error instanceof BackgroundRemovalError) throw error;
    if (signal?.aborted || isAbortError(error)) {
      throw new BackgroundRemovalError('aborted', { cause: error });
    }
    throw new BackgroundRemovalError('network-error', { cause: error });
  }
}

export function getBackgroundRemovalErrorMessage(error: unknown) {
  return error instanceof BackgroundRemovalError
    ? ERROR_MESSAGES[error.category]
    : ERROR_MESSAGES['processing-failed'];
}
