import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decodeImageFile: vi.fn(),
  removeImageBackground: vi.fn(),
}));

vi.mock('./constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./constants')>()),
  HISTORY_LIMIT: 1,
}));

vi.mock('./utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./utils')>()),
  decodeImageFile: mocks.decodeImageFile,
}));

vi.mock('./backgroundRemoval', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./backgroundRemoval')>()),
  BACKGROUND_REMOVAL_ENABLED: true,
  removeImageBackground: mocks.removeImageBackground,
}));

import BoardApp from './BoardApp';

const ORIGINAL_SOURCE = 'data:image/png;base64,b3JpZ2luYWw=';
const PROCESSED_SOURCE = 'data:image/png;base64,cHJvY2Vzc2Vk';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function pasteImage() {
  const file = new File([new Uint8Array([1, 2, 3])], 'portrait.png', {
    type: 'image/png',
  });
  const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(pasteEvent, 'clipboardData', {
    value: {
      files: [file],
      getData: () => '',
      items: [],
    },
  });

  await act(async () => window.dispatchEvent(pasteEvent));
  return screen.findByRole('group', { name: 'portrait.png' });
}

async function openImageMenu(frame: HTMLElement) {
  fireEvent.focus(frame);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'image options' }));
}

beforeEach(() => {
  mocks.decodeImageFile.mockReset();
  mocks.removeImageBackground.mockReset();
  mocks.decodeImageFile.mockResolvedValue({
    src: ORIGINAL_SOURCE,
    name: 'portrait.png',
    naturalWidth: 400,
    naturalHeight: 300,
  });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: {
      configurable: true,
      value: () => false,
    },
    releasePointerCapture: {
      configurable: true,
      value: () => undefined,
    },
    setPointerCapture: {
      configurable: true,
      value: () => undefined,
    },
  });
});

it('does not abort an in-flight request when undo history is exhausted', async () => {
  const request = deferred<string>();
  mocks.removeImageBackground.mockReturnValue(request.promise);
  const user = userEvent.setup();
  render(<BoardApp />);
  const frame = await pasteImage();

  await openImageMenu(frame);
  await user.click(screen.getByRole('menuitem', { name: 'Rotate right' }));
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();

  const restoredFrame = screen.getByRole('group', { name: 'portrait.png' });
  await openImageMenu(restoredFrame);
  await user.click(screen.getByRole('menuitem', { name: 'Remove background' }));
  const signal = mocks.removeImageBackground.mock.calls[0][1] as AbortSignal;

  fireEvent.keyDown(window, { ctrlKey: true, key: 'z' });

  expect(signal.aborted).toBe(false);
  expect(restoredFrame).toHaveAttribute('aria-busy', 'true');
  await act(async () => request.resolve(PROCESSED_SOURCE));
  await waitFor(() =>
    expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
      'src',
      PROCESSED_SOURCE,
    ),
  );
});
