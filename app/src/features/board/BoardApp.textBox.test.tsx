import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BoardApp from './BoardApp';

function mockBoardRect(board: HTMLElement) {
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
}

async function placeTextBox(
  text: string,
  point = { x: 320, y: 240 },
) {
  const user = userEvent.setup();
  const board = screen.getByRole('region', { name: /^Board\./ });
  await user.click(screen.getByRole('button', { name: 'Text box' }));
  fireEvent.pointerDown(board, {
    button: 0,
    clientX: point.x,
    clientY: point.y,
    isPrimary: true,
    pointerId: 1,
  });
  const editor = screen.getByRole('textbox', { name: 'Text box text' });
  await user.type(editor, text);
  fireEvent.blur(editor);
  return screen.getByRole('group', { name: `Text box: ${text.trim()}` });
}

beforeEach(() => {
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

describe('BoardApp text boxes', () => {
  it('places free-floating multiline text, edits it again, and discards blanks', async () => {
    const user = userEvent.setup();
    render(<BoardApp />);
    const board = screen.getByRole('region', { name: /^Board\./ });
    mockBoardRect(board);

    await user.click(screen.getByRole('button', { name: 'Text box' }));
    expect(screen.getByRole('button', { name: 'Text box' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(board).toHaveClass('is-placing-text-box');

    fireEvent.pointerDown(board, {
      button: 0,
      clientX: 400,
      clientY: 300,
      isPrimary: true,
      pointerId: 1,
    });
    const editor = screen.getByRole('textbox', { name: 'Text box text' });
    expect(editor).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Text box' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    const copy = 'Heading\nFirst paragraph\n\nSecond paragraph';
    await user.type(editor, copy);
    fireEvent.blur(editor);
    const frame = screen.getByRole('group', {
      name: /Text box: Heading\s+First paragraph\s+Second paragraph/,
    });
    expect(frame.querySelector('.text-box-copy')).toHaveTextContent(
      /Heading\s+First paragraph\s+Second paragraph/,
    );

    await user.dblClick(frame);
    const reopenedEditor = screen.getByRole('textbox', {
      name: 'Text box text',
    });
    expect(reopenedEditor).toHaveValue(copy);
    await user.clear(reopenedEditor);
    await user.type(reopenedEditor, 'Revised annotation');
    fireEvent.blur(reopenedEditor);
    expect(
      screen.getByRole('group', { name: 'Text box: Revised annotation' }),
    ).toBeVisible();
    await user.dblClick(
      screen.getByRole('group', { name: 'Text box: Revised annotation' }),
    );
    const clearedEditor = screen.getByRole('textbox', {
      name: 'Text box text',
    });
    await user.clear(clearedEditor);
    fireEvent.blur(clearedEditor);
    expect(
      screen.queryByRole('group', { name: 'Text box: Revised annotation' }),
    ).toBeNull();

    fireEvent.pointerDown(board, {
      button: 0,
      clientX: 50,
      clientY: 50,
      pointerId: 2,
    });
    await user.click(screen.getByRole('button', { name: 'Text box' }));
    fireEvent.pointerDown(board, {
      button: 0,
      clientX: 100,
      clientY: 100,
      isPrimary: true,
      pointerId: 3,
    });
    fireEvent.blur(screen.getByRole('textbox', { name: 'Text box text' }));
    expect(screen.queryByRole('group', { name: 'Text box: Blank' })).toBeNull();
  });

  it('offers only the compact preset formatter and persists its choices', async () => {
    const user = userEvent.setup();
    render(<BoardApp />);
    const board = screen.getByRole('region', { name: /^Board\./ });
    mockBoardRect(board);
    const frame = await placeTextBox('Planning note');

    fireEvent.focus(frame);
    const toolbar = screen.getByRole('toolbar', { name: 'Text formatting' });
    await user.selectOptions(
      within(toolbar).getByRole('combobox', { name: 'Text style' }),
      'display',
    );
    const black = within(toolbar).getByRole('radio', { name: 'Black' });
    black.focus();
    fireEvent.keyDown(black, { key: 'ArrowRight' });
    expect(within(toolbar).getByRole('radio', { name: 'Blue' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const leftAlign = within(toolbar).getByRole('radio', {
      name: 'Left align',
    });
    leftAlign.focus();
    fireEvent.keyDown(leftAlign, { key: 'ArrowRight' });
    expect(
      within(toolbar).getByRole('radio', { name: 'Center align' }),
    ).toHaveAttribute('aria-checked', 'true');

    const item = frame.closest<HTMLElement>('[data-item-type="text-box"]')!;
    expect(item).toHaveAttribute('data-text-style', 'display');
    expect(item).toHaveAttribute('data-text-color', 'blue');
    expect(item).toHaveAttribute('data-text-alignment', 'center');
    expect(within(toolbar).queryByLabelText(/font family/i)).toBeNull();
    expect(within(toolbar).queryByLabelText(/border|shadow|spacing/i)).toBeNull();

    fireEvent.pointerDown(board, {
      button: 0,
      clientX: 40,
      clientY: 40,
      pointerId: 4,
    });
    expect(screen.queryByRole('toolbar', { name: 'Text formatting' })).toBeNull();
    fireEvent.focus(frame);
    expect(
      within(screen.getByRole('toolbar', { name: 'Text formatting' }))
        .getByRole('radio', { name: 'Center align' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('reflows on a side drag without scaling and scales from a corner', async () => {
    render(<BoardApp />);
    const board = screen.getByRole('region', { name: /^Board\./ });
    mockBoardRect(board);
    const frame = await placeTextBox(
      'A long annotation that should wrap when its width changes.',
      { x: 300, y: 200 },
    );
    fireEvent.focus(frame);
    const item = frame.closest<HTMLElement>('[data-item-type="text-box"]')!;
    const originalScale = Number(item.dataset.textScale);
    const originalWidth = Number.parseFloat(item.style.width);

    const rightSide = screen.getByRole('button', {
      name: 'Resize text box from right side',
    });
    fireEvent.pointerDown(rightSide, {
      button: 0,
      clientX: 720,
      clientY: 221,
      pointerId: 7,
    });
    fireEvent.pointerMove(board, {
      clientX: 600,
      clientY: 221,
      pointerId: 7,
    });
    fireEvent.pointerUp(board, { pointerId: 7 });

    expect(Number.parseFloat(item.style.width)).toBeLessThan(originalWidth);
    expect(Number(item.dataset.textScale)).toBe(originalScale);
    expect(frame).toHaveTextContent(
      'A long annotation that should wrap when its width changes.',
    );

    const southeast = screen.getByRole('button', {
      name: 'Resize text box from SE corner',
    });
    fireEvent.pointerDown(southeast, {
      button: 0,
      clientX: 600,
      clientY: 242,
      pointerId: 8,
    });
    fireEvent.pointerMove(board, {
      clientX: 750,
      clientY: 263,
      pointerId: 8,
    });
    fireEvent.pointerUp(board, { pointerId: 8 });
    expect(Number(item.dataset.textScale)).toBeGreaterThan(originalScale);
  });

  it('duplicates, reorders, rotates, and deletes text as a canvas object', async () => {
    const user = userEvent.setup();
    render(<BoardApp />);
    const board = screen.getByRole('region', { name: /^Board\./ });
    mockBoardRect(board);
    const first = await placeTextBox('Layer one', { x: 240, y: 200 });

    fireEvent.pointerDown(board, {
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 2,
    });
    await placeTextBox('Layer two', { x: 260, y: 220 });
    fireEvent.focus(first);
    await user.click(screen.getByRole('button', { name: 'text box options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Bring forward' }));
    expect(
      Array.from(document.querySelectorAll('[data-item-type="text-box"]')).map(
        (element) => element.querySelector('.text-box-copy')?.textContent,
      ),
    ).toEqual(['Layer two', 'Layer one']);

    await user.click(screen.getByRole('button', { name: 'text box options' }));
    await user.click(
      screen.getByRole('menuitem', { name: 'Duplicate text box' }),
    );
    expect(
      screen.getAllByRole('group', { name: 'Text box: Layer one' }),
    ).toHaveLength(2);

    const selectedCopy = screen
      .getAllByRole('group', { name: 'Text box: Layer one' })
      .find((candidate) =>
        candidate.closest('[data-item-type="text-box"]')?.classList.contains(
          'is-selected',
        ),
      )!;
    await user.click(screen.getByRole('button', { name: 'text box options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rotate right' }));
    expect(selectedCopy.style.transform).toContain('rotate(15deg)');

    await user.click(screen.getByRole('button', { name: 'text box options' }));
    await user.click(
      screen.getByRole('menuitem', { name: 'Delete text box' }),
    );
    expect(
      screen.getAllByRole('group', { name: 'Text box: Layer one' }),
    ).toHaveLength(1);
  });

  it('records completed text creation as a single undoable board change', async () => {
    const user = userEvent.setup();
    render(<BoardApp />);
    const board = screen.getByRole('region', { name: /^Board\./ });
    mockBoardRect(board);

    await placeTextBox('One history entry');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(
      screen.queryByRole('group', { name: 'Text box: One history entry' }),
    ).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(
      screen.getByRole('group', { name: 'Text box: One history entry' }),
    ).toBeVisible();
  });
});
