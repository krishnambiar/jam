import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CanvasImage } from './types';
import {
  BackgroundRemovalError,
  activeImageSource,
  getBackgroundRemovalErrorMessage,
  imageDataUrlToBlob,
  removeImageBackground,
} from './backgroundRemoval';

const ORIGINAL_SOURCE = 'data:image/jpeg;base64,AQID';
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP8z8DQwMDAwAAACooBge1WxT4AAAAASUVORK5CYII=';
const PNG_BYTES = Uint8Array.from(atob(PNG_BASE64), (character) =>
  character.charCodeAt(0),
);

function image(overrides: Partial<CanvasImage> = {}): CanvasImage {
  return {
    kind: 'image',
    id: 'image-1',
    src: ORIGINAL_SOURCE,
    name: 'photo.jpg',
    x: 100,
    y: 100,
    width: 200,
    height: 150,
    rotation: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('activeImageSource', () => {
  it('uses the original source for older and restored image records', () => {
    expect(activeImageSource(image())).toBe(ORIGINAL_SOURCE);
    expect(
      activeImageSource(
        image({
          backgroundRemoved: false,
          backgroundRemovedSrc: 'data:image/png;base64,processed',
        }),
      ),
    ).toBe(ORIGINAL_SOURCE);
  });

  it('uses a committed active variant and falls back for malformed state', () => {
    const variant = 'data:image/png;base64,processed';
    expect(
      activeImageSource(
        image({ backgroundRemoved: true, backgroundRemovedSrc: variant }),
      ),
    ).toBe(variant);
    expect(activeImageSource(image({ backgroundRemoved: true }))).toBe(
      ORIGINAL_SOURCE,
    );
    expect(
      activeImageSource(
        image({ backgroundRemoved: true, backgroundRemovedSrc: variant }),
        false,
      ),
    ).toBe(ORIGINAL_SOURCE);
  });
});

describe('imageDataUrlToBlob', () => {
  it('decodes supported base64 data URLs without filename metadata', async () => {
    const blob = await imageDataUrlToBlob(ORIGINAL_SOURCE);

    expect(blob.type).toBe('image/jpeg');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([
      1, 2, 3,
    ]);
  });

  it('rejects unsupported and malformed image sources with typed errors', async () => {
    await expect(
      imageDataUrlToBlob('https://example.com/photo.jpg'),
    ).rejects.toMatchObject({ category: 'invalid-image' });
    await expect(
      imageDataUrlToBlob('data:image/gif;base64,AQID'),
    ).rejects.toMatchObject({ category: 'unsupported-image' });
    await expect(
      imageDataUrlToBlob('data:image/png,not-base64'),
    ).rejects.toMatchObject({ category: 'invalid-image' });
  });
});

describe('removeImageBackground', () => {
  it('posts raw source bytes and returns a verified PNG data URL', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 2, height: 1, close: vi.fn() })),
    );
    vi.stubGlobal(
      'FileReader',
      class {
        static readonly EMPTY = 0;
        static readonly LOADING = 1;
        static readonly DONE = 2;
        readyState = 0;
        result: string | ArrayBuffer | null = null;
        error: DOMException | null = null;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onabort: (() => void) | null = null;

        readAsDataURL(blob: Blob) {
          this.readyState = 1;
          void blob.arrayBuffer().then((buffer) => {
            this.result = `data:${blob.type};base64,${btoa(
              String.fromCharCode(...new Uint8Array(buffer)),
            )}`;
            this.readyState = 2;
            this.onload?.();
          });
        }

        abort() {
          this.readyState = 2;
          this.onabort?.();
        }
      },
    );
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestBlob = init?.body as Blob;
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({ 'Content-Type': 'image/jpeg' });
      expect(requestBlob.type).toBe('image/jpeg');
      expect(Array.from(new Uint8Array(await requestBlob.arrayBuffer()))).toEqual([
        1, 2, 3,
      ]);

      return new Response(PNG_BYTES, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(removeImageBackground(ORIGINAL_SOURCE)).resolves.toBe(
      `data:image/png;base64,${PNG_BASE64}`,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/images/remove-background',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects a truncated response even when it has a PNG signature', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(PNG_BYTES.slice(0, 20), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      ),
    );

    await expect(removeImageBackground(ORIGINAL_SOURCE)).rejects.toMatchObject({
      category: 'invalid-response',
    });
  });

  it('rejects a structurally valid PNG that the browser cannot decode', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new DOMException('Decode failed', 'EncodingError');
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(PNG_BYTES, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      ),
    );

    await expect(removeImageBackground(ORIGINAL_SOURCE)).rejects.toMatchObject({
      category: 'invalid-response',
    });
  });

  it('classifies a failed PNG data-URL conversion as an invalid response', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 2, height: 1, close: vi.fn() })),
    );
    vi.stubGlobal(
      'FileReader',
      class {
        static readonly LOADING = 1;
        readyState = 0;
        result = null;
        error = new DOMException('Encoding failed', 'EncodingError');
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onabort: (() => void) | null = null;

        readAsDataURL() {
          this.onerror?.();
        }

        abort() {
          this.onabort?.();
        }
      },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(PNG_BYTES, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      ),
    );

    await expect(removeImageBackground(ORIGINAL_SOURCE)).rejects.toMatchObject({
      category: 'invalid-response',
    });
  });

  it.each([
    [413, 'image_too_large', 'image-too-large'],
    [415, 'unsupported_media_type', 'unsupported-image'],
    [422, 'animated_image_unsupported', 'invalid-image'],
    [503, 'inference_busy', 'service-busy'],
    [503, 'model_unavailable', 'service-unavailable'],
    [500, 'processing_failed', 'processing-failed'],
  ] as const)(
    'maps status %s / %s to %s without exposing server text',
    async (status, code, category) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json(
            { detail: { code, message: 'Sensitive internal server text' } },
            { status },
          ),
        ),
      );

      const error = await removeImageBackground(ORIGINAL_SOURCE).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(BackgroundRemovalError);
      expect(error).toMatchObject({ category });
      expect(getBackgroundRemovalErrorMessage(error)).not.toContain('Sensitive');
    },
  );

  it('rejects successful responses that are not verified PNG data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      ),
    );

    await expect(removeImageBackground(ORIGINAL_SOURCE)).rejects.toMatchObject({
      category: 'invalid-response',
    });
  });

  it('classifies aborts separately from network failures', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('Aborted', 'AbortError');
      }),
    );

    await expect(
      removeImageBackground(ORIGINAL_SOURCE, controller.signal),
    ).rejects.toMatchObject({ category: 'aborted' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network details');
      }),
    );
    await expect(removeImageBackground(ORIGINAL_SOURCE)).rejects.toMatchObject({
      category: 'network-error',
    });
  });
});
