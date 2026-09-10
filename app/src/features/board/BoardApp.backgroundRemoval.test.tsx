import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decodeImageFile: vi.fn(),
  removeImageBackground: vi.fn(),
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
import { BackgroundRemovalError } from './backgroundRemoval';

const ORIGINAL_SOURCE = 'data:image/png;base64,b3JpZ2luYWw=';
const PROCESSED_SOURCE = 'data:image/png;base64,cHJvY2Vzc2Vk';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function pasteImage(name = 'portrait.png') {
  const file = new File([new Uint8Array([1, 2, 3])], name, {
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

  await act(async () => {
    window.dispatchEvent(pasteEvent);
  });
  return screen.findByRole('group', { name });
}

async function pasteBoardItem(item: Record<string, unknown>) {
  const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(pasteEvent, 'clipboardData', {
    value: {
      files: [],
      getData: (type: string) =>
        type === 'application/x-untitled-jam-item' ? JSON.stringify(item) : '',
      items: [],
    },
  });
  await act(async () => {
    window.dispatchEvent(pasteEvent);
  });
}

async function openImageMenu(
  frame: HTMLElement,
  user = userEvent.setup(),
) {
  fireEvent.focus(frame);
  await user.click(screen.getByRole('button', { name: 'image options' }));
  return user;
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
    scrollIntoView: {
      configurable: true,
      value: () => undefined,
    },
  });
});

describe('BoardApp background removal', () => {
  it('offers the action only for images and preserves menu keyboard focus', async () => {
    const user = userEvent.setup();
    render(<BoardApp />);
    await pasteBoardItem({
      color: 'blue',
      height: 180,
      id: 'shape-from-clipboard',
      kind: 'shape',
      rotation: 0,
      shape: 'circle',
      width: 180,
      x: 500,
      y: 350,
    });

    const shape = await screen.findByRole('group', { name: 'Circle shape' });
    fireEvent.focus(shape);
    const trigger = screen.getByRole('button', { name: 'shape options' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('menuitem', { name: /background/i })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Duplicate shape' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('uses one menu tab stop and closes when focus leaves the menu anchor', async () => {
    const user = userEvent.setup();
    render(<BoardApp />);
    const frame = await pasteImage();
    fireEvent.focus(frame);
    const trigger = screen.getByRole('button', { name: 'image options' });
    trigger.focus();

    await user.keyboard('{Enter}');
    const menu = screen.getByRole('menu', { name: 'image options' });
    const duplicate = screen.getByRole('menuitem', {
      name: 'Duplicate image',
    });
    const copy = screen.getByRole('menuitem', { name: 'Copy image' });
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    expect(duplicate).toHaveAttribute('tabindex', '0');
    expect(copy).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{ArrowDown}');
    expect(copy).toHaveFocus();
    expect(copy).toHaveAttribute('tabindex', '0');
    expect(duplicate).toHaveAttribute('tabindex', '-1');

    await user.tab();
    await waitFor(() =>
      expect(screen.queryByRole('menu', { name: 'image options' })).toBeNull(),
    );
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu', { name: 'image options' })).toBeVisible();
    expect(
      screen.getByRole('menuitem', { name: 'Duplicate image' }),
    ).toHaveFocus();
    await user.tab({ shift: true });
    await waitFor(() =>
      expect(screen.queryByRole('menu', { name: 'image options' })).toBeNull(),
    );
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu', { name: 'image options' })).toBeVisible();
    act(() => screen.getByRole('region', { name: /^Board\./ }).focus());
    await waitFor(() =>
      expect(screen.queryByRole('menu', { name: 'image options' })).toBeNull(),
    );
  });

  it('shows pending state, commits once, restores, and reapplies from cache', async () => {
    const request = deferred<string>();
    mocks.removeImageBackground.mockReturnValue(request.promise);
    const user = userEvent.setup();
    render(<BoardApp />);
    const frame = await pasteImage();

    await openImageMenu(frame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove background' }));

    expect(mocks.removeImageBackground).toHaveBeenCalledOnce();
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Removing background');
    expect(frame).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'image options' }));
    expect(
      screen.getByRole('menuitem', { name: 'Removing background…' }),
    ).toBeDisabled();

    await act(async () => request.resolve(PROCESSED_SOURCE));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
        'src',
        PROCESSED_SOURCE,
      ),
    );
    expect(frame).not.toHaveAttribute('aria-busy');

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
      'src',
      ORIGINAL_SOURCE,
    );
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
      'src',
      PROCESSED_SOURCE,
    );

    const restoredFrame = screen.getByRole('group', { name: 'portrait.png' });
    await openImageMenu(restoredFrame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Restore background' }));
    expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
      'src',
      ORIGINAL_SOURCE,
    );
    expect(restoredFrame).toHaveFocus();

    await openImageMenu(restoredFrame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove background' }));
    expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
      'src',
      PROCESSED_SOURCE,
    );
    expect(mocks.removeImageBackground).toHaveBeenCalledOnce();
  });

  it('leaves the original untouched after failure and allows retry', async () => {
    mocks.removeImageBackground
      .mockRejectedValueOnce(new BackgroundRemovalError('service-busy'))
      .mockResolvedValueOnce(PROCESSED_SOURCE);
    const user = userEvent.setup();
    render(<BoardApp />);
    const frame = await pasteImage();

    await openImageMenu(frame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove background' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Background removal is busy',
      ),
    );
    expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
      'src',
      ORIGINAL_SOURCE,
    );
    expect(frame).not.toHaveAttribute('aria-busy');

    await openImageMenu(frame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove background' }));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
        'src',
        PROCESSED_SOURCE,
      ),
    );
    expect(mocks.removeImageBackground).toHaveBeenCalledTimes(2);
  });

  it('defers completion until a move commits and keeps the edits separate', async () => {
    const request = deferred<string>();
    mocks.removeImageBackground.mockReturnValue(request.promise);
    const user = userEvent.setup();
    render(<BoardApp />);
    const frame = await pasteImage();
    const board = screen.getByRole('region', { name: /^Board\./ });
    vi.spyOn(board, 'getBoundingClientRect').mockReturnValue({
      bottom: 900,
      height: 900,
      left: 0,
      right: 1600,
      top: 0,
      width: 1600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    await openImageMenu(frame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove background' }));
    const item = frame.closest<HTMLElement>('[data-item-id]')!;
    const initialLeft = item.style.left;

    fireEvent.pointerDown(frame, {
      button: 0,
      clientX: 800,
      clientY: 450,
      pointerId: 7,
    });
    fireEvent.pointerMove(board, {
      clientX: 900,
      clientY: 500,
      pointerId: 7,
    });
    await waitFor(() => expect(item.style.left).not.toBe(initialLeft));
    const movedLeft = item.style.left;

    await act(async () => request.resolve(PROCESSED_SOURCE));
    expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
      'src',
      ORIGINAL_SOURCE,
    );

    fireEvent.pointerUp(board, { pointerId: 7 });
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
        'src',
        PROCESSED_SOURCE,
      ),
    );
    expect(item.style.left).toBe(movedLeft);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
      'src',
      ORIGINAL_SOURCE,
    );
    expect(item.style.left).toBe(movedLeft);
  });

  it('keeps a completed result pending until an eraser gesture ends', async () => {
    const request = deferred<string>();
    mocks.removeImageBackground.mockReturnValue(request.promise);
    const user = userEvent.setup();
    render(<BoardApp />);
    const frame = await pasteImage();

    await openImageMenu(frame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove background' }));
    await user.click(screen.getByRole('button', { name: 'Ink eraser' }));
    const surface = document.querySelector<HTMLElement>('.drawing-surface')!;
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      bottom: 900,
      height: 900,
      left: 0,
      right: 1600,
      top: 0,
      width: 1600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(surface, {
      button: 0,
      clientX: 40,
      clientY: 40,
      isPrimary: true,
      pointerId: 11,
      pointerType: 'mouse',
      timeStamp: 1,
    });

    await act(async () => request.resolve(PROCESSED_SOURCE));
    expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
      'src',
      ORIGINAL_SOURCE,
    );
    expect(frame).toHaveAttribute('aria-busy', 'true');

    fireEvent.pointerUp(surface, {
      clientX: 40,
      clientY: 40,
      isPrimary: true,
      pointerId: 11,
      pointerType: 'mouse',
      timeStamp: 2,
    });
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
        'src',
        PROCESSED_SOURCE,
      ),
    );
    expect(frame).not.toHaveAttribute('aria-busy');
  });

  it('updates the originating slide without changing the active slide', async () => {
    const request = deferred<string>();
    mocks.removeImageBackground.mockReturnValue(request.promise);
    const user = userEvent.setup();
    render(<BoardApp />);
    const frame = await pasteImage();
    await openImageMenu(frame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove background' }));

    await user.click(screen.getByRole('button', { name: 'Create new slide' }));
    expect(screen.queryByRole('img', { name: 'portrait.png' })).not.toBeInTheDocument();

    await act(async () => request.resolve(PROCESSED_SOURCE));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Background removed on slide 1',
    );
    expect(screen.queryByRole('img', { name: 'portrait.png' })).not.toBeInTheDocument();
    expect(
      document.querySelector<HTMLImageElement>('.slide-preview-item img')?.src,
    ).toContain(PROCESSED_SOURCE);

    await user.click(screen.getByRole('button', { name: 'Previous slide' }));
    expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
      'src',
      PROCESSED_SOURCE,
    );
  });

  it('aborts and ignores an in-flight result on undo and unmount', async () => {
    const firstRequest = deferred<string>();
    const secondRequest = deferred<string>();
    mocks.removeImageBackground
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    const user = userEvent.setup();
    const view = render(<BoardApp />);
    const frame = await pasteImage();
    await openImageMenu(frame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove background' }));
    const firstSignal = mocks.removeImageBackground.mock.calls[0][1] as AbortSignal;

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(firstSignal.aborted).toBe(true);
    expect(screen.queryByRole('img', { name: 'portrait.png' })).not.toBeInTheDocument();
    await act(async () => firstRequest.resolve(PROCESSED_SOURCE));
    expect(screen.queryByRole('img', { name: 'portrait.png' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    const restoredFrame = await screen.findByRole('group', {
      name: 'portrait.png',
    });
    await openImageMenu(restoredFrame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove background' }));
    const secondSignal = mocks.removeImageBackground.mock.calls[1][1] as AbortSignal;
    view.unmount();
    expect(secondSignal.aborted).toBe(true);
  });

  it('does not abort an in-flight request when redo has no history', async () => {
    const request = deferred<string>();
    mocks.removeImageBackground.mockReturnValue(request.promise);
    const user = userEvent.setup();
    render(<BoardApp />);
    const frame = await pasteImage();
    await openImageMenu(frame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove background' }));
    const signal = mocks.removeImageBackground.mock.calls[0][1] as AbortSignal;

    fireEvent.keyDown(window, { ctrlKey: true, key: 'y' });

    expect(signal.aborted).toBe(false);
    expect(frame).toHaveAttribute('aria-busy', 'true');
    await act(async () => request.resolve(PROCESSED_SOURCE));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
        'src',
        PROCESSED_SOURCE,
      ),
    );
  });

  it('does not abort an in-flight request when the sole slide cannot be deleted', async () => {
    const request = deferred<string>();
    mocks.removeImageBackground.mockReturnValue(request.promise);
    const user = userEvent.setup();
    render(<BoardApp />);
    const frame = await pasteImage();
    await openImageMenu(frame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove background' }));
    const signal = mocks.removeImageBackground.mock.calls[0][1] as AbortSignal;

    await user.click(
      screen.getByRole('button', {
        name: 'Slide 1 of 1. Open slide overview',
      }),
    );
    fireEvent.keyDown(window, { key: 'Delete' });

    expect(signal.aborted).toBe(false);
    await act(async () => request.resolve(PROCESSED_SOURCE));
    await user.click(
      screen.getByRole('button', { name: 'Close slide overview' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
        'src',
        PROCESSED_SOURCE,
      ),
    );
  });

  it('duplicates committed variants without inheriting an active job', async () => {
    mocks.removeImageBackground.mockResolvedValue(PROCESSED_SOURCE);
    const user = userEvent.setup();
    render(<BoardApp />);
    const frame = await pasteImage();
    await openImageMenu(frame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove background' }));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'portrait.png' })).toHaveAttribute(
        'src',
        PROCESSED_SOURCE,
      ),
    );

    await openImageMenu(frame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate image' }));
    const images = screen.getAllByRole('img', { name: 'portrait.png' });
    expect(images).toHaveLength(2);
    images.forEach((image) => expect(image).toHaveAttribute('src', PROCESSED_SOURCE));
    expect(screen.queryByRole('group', { busy: true })).toBeNull();

    const duplicate = screen.getAllByRole('group', { name: 'portrait.png' })[1];
    await openImageMenu(duplicate, user);
    await user.click(screen.getByRole('menuitem', { name: 'Restore background' }));
    expect(screen.getAllByRole('img', { name: 'portrait.png' })[1]).toHaveAttribute(
      'src',
      ORIGINAL_SOURCE,
    );
    expect(mocks.removeImageBackground).toHaveBeenCalledOnce();
  });

  it('does not attach an active job to a duplicate', async () => {
    const request = deferred<string>();
    mocks.removeImageBackground.mockReturnValue(request.promise);
    const user = userEvent.setup();
    render(<BoardApp />);
    const frame = await pasteImage();
    await openImageMenu(frame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Remove background' }));

    await user.click(screen.getByRole('button', { name: 'image options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate image' }));
    const frames = screen.getAllByRole('group', { name: 'portrait.png' });
    expect(frames).toHaveLength(2);
    expect(frames.filter((candidate) => candidate.ariaBusy === 'true')).toHaveLength(
      1,
    );

    const duplicate = frames.find((candidate) => candidate.ariaBusy !== 'true')!;
    await openImageMenu(duplicate, user);
    expect(
      screen.getByRole('menuitem', { name: 'Remove background' }),
    ).toBeEnabled();
  });

  it('pastes committed original and processed variants for instant restore', async () => {
    const user = userEvent.setup();
    render(<BoardApp />);
    await pasteBoardItem({
      backgroundRemoved: true,
      backgroundRemovedSrc: PROCESSED_SOURCE,
      height: 300,
      id: 'processed-image-from-clipboard',
      kind: 'image',
      name: 'copied.png',
      rotation: 0,
      src: ORIGINAL_SOURCE,
      width: 400,
      x: 700,
      y: 400,
    });

    const frame = await screen.findByRole('group', { name: 'copied.png' });
    expect(screen.getByRole('img', { name: 'copied.png' })).toHaveAttribute(
      'src',
      PROCESSED_SOURCE,
    );
    await openImageMenu(frame, user);
    await user.click(screen.getByRole('menuitem', { name: 'Restore background' }));
    expect(screen.getByRole('img', { name: 'copied.png' })).toHaveAttribute(
      'src',
      ORIGINAL_SOURCE,
    );
    expect(mocks.removeImageBackground).not.toHaveBeenCalled();
  });

  it('copies both committed variants in the board clipboard payload', async () => {
    render(<BoardApp />);
    await pasteBoardItem({
      backgroundRemoved: true,
      backgroundRemovedSrc: PROCESSED_SOURCE,
      height: 300,
      id: 'processed-image-to-copy',
      kind: 'image',
      name: 'copy-me.png',
      rotation: 0,
      src: ORIGINAL_SOURCE,
      width: 400,
      x: 700,
      y: 400,
    });
    fireEvent.focus(await screen.findByRole('group', { name: 'copy-me.png' }));

    const clipboardValues = new Map<string, string>();
    const copyEvent = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, 'clipboardData', {
      value: {
        setData: (type: string, value: string) =>
          clipboardValues.set(type, value),
      },
    });
    act(() => window.dispatchEvent(copyEvent));

    expect(
      JSON.parse(
        clipboardValues.get('application/x-untitled-jam-item') ?? '{}',
      ),
    ).toMatchObject({
      backgroundRemoved: true,
      backgroundRemovedSrc: PROCESSED_SOURCE,
      src: ORIGINAL_SOURCE,
    });
  });
});
