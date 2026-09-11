import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BoardApp from './BoardApp';
import {
  LASER_TRAIL_LIFETIME_MS,
  laserTrailOpacity,
} from './laserTrail';

const BOARD_RECT = {
  bottom: 900,
  height: 900,
  left: 0,
  right: 1600,
  top: 0,
  width: 1600,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

let clock = 0;
let nextAnimationFrameId = 1;
let animationFrames = new Map<number, FrameRequestCallback>();
let capturedPointers = new Set<number>();
let releasePointerCapture: ReturnType<typeof vi.fn>;

function runAnimationFrame(now: number) {
  clock = now;
  const callbacks = Array.from(animationFrames.values());
  animationFrames.clear();
  act(() => callbacks.forEach((callback) => callback(now)));
}

function setClock(now: number) {
  clock = now;
}

function activateTool(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

function activeDrawingSurface() {
  const surface = document.querySelector<HTMLElement>('.drawing-surface');
  expect(surface).not.toBeNull();
  vi.spyOn(surface!, 'getBoundingClientRect').mockReturnValue(BOARD_RECT);
  return surface!;
}

function drawPointerEvent(
  surface: HTMLElement,
  type: 'down' | 'move' | 'up',
  point: { x: number; y: number },
  pointerId = 1,
  pointerType = 'mouse',
) {
  const init = {
    button: 0,
    clientX: point.x,
    clientY: point.y,
    isPrimary: true,
    pointerId,
    pointerType,
  };
  if (type === 'down') fireEvent.pointerDown(surface, init);
  else if (type === 'move') fireEvent.pointerMove(surface, init);
  else fireEvent.pointerUp(surface, init);
}

beforeEach(() => {
  clock = 0;
  nextAnimationFrameId = 1;
  animationFrames = new Map();
  capturedPointers = new Set();
  releasePointerCapture = vi.fn((pointerId: number) => {
    capturedPointers.delete(pointerId);
  });

  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = nextAnimationFrameId;
    nextAnimationFrameId += 1;
    animationFrames.set(id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    animationFrames.delete(id);
  });

  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: {
      configurable: true,
      value: (pointerId: number) => capturedPointers.has(pointerId),
    },
    releasePointerCapture: {
      configurable: true,
      value: releasePointerCapture,
    },
    setPointerCapture: {
      configurable: true,
      value: (pointerId: number) => capturedPointers.add(pointerId),
    },
    scrollIntoView: {
      configurable: true,
      value: () => undefined,
    },
  });
});

afterEach(() => {
  animationFrames.clear();
  vi.restoreAllMocks();
});

describe('BoardApp laser pointer', () => {
  it('is the bottom tool, uses a pointer glyph, and opens no settings', () => {
    render(<BoardApp />);
    const palette = screen.getByRole('navigation', { name: 'Board tools' });
    const toolButtons = within(palette).getAllByRole('button');
    const laserButton = screen.getByRole('button', { name: 'Laser pointer' });

    expect(toolButtons.at(-1)).toBe(laserButton);
    expect(laserButton.querySelector('.lucide-crosshair')).not.toBeNull();
    expect(laserButton.querySelector('.lucide-brush')).toBeNull();

    const penButton = screen.getByRole('button', { name: 'Pen' });
    fireEvent.click(penButton);
    fireEvent.click(penButton);
    expect(screen.getByRole('radiogroup', { name: 'Drawing color' })).toBeVisible();

    fireEvent.click(laserButton);
    expect(laserButton).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('region', { name: /Laser pointer active/ }),
    ).toHaveClass('is-laser-pointing');
    expect(document.querySelector('.drawing-surface')).toHaveClass(
      'is-laser-pointing',
    );
    expect(
      screen.queryByRole('radiogroup', { name: 'Drawing color' }),
    ).toBeNull();
    expect(
      screen.queryByRole('radiogroup', { name: 'Drawing style' }),
    ).toBeNull();

    fireEvent.click(laserButton);
    expect(laserButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it.each(['mouse', 'touch', 'pen'])(
    'draws a smooth fixed-red trail with %s input',
    (pointerType) => {
      render(<BoardApp />);
      activateTool('Laser pointer');
      const surface = activeDrawingSurface();

      drawPointerEvent(surface, 'down', { x: 100, y: 100 }, 1, pointerType);
      drawPointerEvent(surface, 'move', { x: 300, y: 200 }, 1, pointerType);
      drawPointerEvent(surface, 'move', { x: 500, y: 300 }, 1, pointerType);

      const core = document.querySelector<SVGPathElement>('.laser-trail-core');
      expect(core).not.toBeNull();
      expect(core).toHaveAttribute('stroke', '#dd4f44');
      expect(core?.getAttribute('d')).toContain('Q');
      expect(document.querySelector('.laser-trail-tip')).not.toBeNull();

      drawPointerEvent(surface, 'up', { x: 500, y: 300 }, 1, pointerType);
      expect(document.querySelector('.laser-trail')).not.toBeNull();
      expect(document.querySelector('.completed-ink-layer')).toBeNull();
    },
  );

  it('evaporates from the oldest end and fully disappears three seconds after release', () => {
    render(<BoardApp />);
    activateTool('Laser pointer');
    const surface = activeDrawingSurface();

    drawPointerEvent(surface, 'down', { x: 100, y: 100 });
    setClock(1000);
    drawPointerEvent(surface, 'move', { x: 300, y: 200 });
    setClock(2200);
    drawPointerEvent(surface, 'move', { x: 500, y: 300 });
    expect(document.querySelector('.laser-trail-core')?.getAttribute('d')).toContain(
      '100 100',
    );

    runAnimationFrame(3101);
    const remainingPath = Array.from(
      document.querySelectorAll<SVGPathElement>('.laser-trail-core'),
    )
      .map((path) => path.getAttribute('d'))
      .join(' ');
    expect(remainingPath).not.toContain('100 100');
    expect(remainingPath).toContain('300 200');
    expect(remainingPath).toContain('500 300');

    drawPointerEvent(surface, 'up', { x: 500, y: 300 });
    runAnimationFrame(5601);
    const fadingTip = document.querySelector('.laser-trail-tip');
    expect(fadingTip).not.toBeNull();
    expect(Number(fadingTip?.getAttribute('opacity'))).toBeLessThan(1);

    runAnimationFrame(3101 + LASER_TRAIL_LIFETIME_MS + 1);
    expect(document.querySelector('.laser-trail')).toBeNull();
    expect(animationFrames.size).toBe(0);
  });

  it('keeps the active tip visible while held and clears it if the window loses focus', () => {
    render(<BoardApp />);
    activateTool('Laser pointer');
    const surface = activeDrawingSurface();

    drawPointerEvent(surface, 'down', { x: 240, y: 180 }, 3);
    runAnimationFrame(LASER_TRAIL_LIFETIME_MS + 500);
    expect(document.querySelector('.laser-trail-tip')).not.toBeNull();
    expect(capturedPointers.has(3)).toBe(true);

    fireEvent(window, new Event('blur'));
    expect(document.querySelector('.laser-trail')).toBeNull();
    expect(releasePointerCapture).toHaveBeenCalledWith(3);
    expect(animationFrames.size).toBe(0);
  });

  it('lets successive gestures coexist and expire independently', () => {
    render(<BoardApp />);
    activateTool('Laser pointer');
    const surface = activeDrawingSurface();

    drawPointerEvent(surface, 'down', { x: 100, y: 100 }, 4);
    drawPointerEvent(surface, 'move', { x: 280, y: 180 }, 4);
    drawPointerEvent(surface, 'up', { x: 360, y: 220 }, 4);

    setClock(1000);
    drawPointerEvent(surface, 'down', { x: 500, y: 300 }, 5);
    drawPointerEvent(surface, 'move', { x: 680, y: 420 }, 5);
    drawPointerEvent(surface, 'up', { x: 760, y: 480 }, 5);
    expect(document.querySelectorAll('.laser-trail')).toHaveLength(2);

    runAnimationFrame(LASER_TRAIL_LIFETIME_MS + 1);
    expect(document.querySelectorAll('.laser-trail')).toHaveLength(1);

    runAnimationFrame(LASER_TRAIL_LIFETIME_MS + 1001);
    expect(document.querySelector('.laser-trail')).toBeNull();
  });

  it('does not create history or clear the existing redo stack', () => {
    render(<BoardApp />);
    activateTool('Pen');
    let surface = activeDrawingSurface();
    drawPointerEvent(surface, 'down', { x: 120, y: 120 });
    drawPointerEvent(surface, 'move', { x: 360, y: 240 });
    drawPointerEvent(surface, 'up', { x: 520, y: 280 });
    expect(document.querySelector('.completed-ink-layer')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(document.querySelector('.completed-ink-layer')).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();

    activateTool('Laser pointer');
    surface = activeDrawingSurface();
    drawPointerEvent(surface, 'down', { x: 160, y: 160 }, 2);
    drawPointerEvent(surface, 'move', { x: 420, y: 260 }, 2);
    drawPointerEvent(surface, 'up', { x: 600, y: 320 }, 2);
    expect(document.querySelector('.laser-trail')).not.toBeNull();
    expect(document.querySelector('.completed-ink-layer')).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(document.querySelector('.laser-trail')).toBeNull();
    expect(document.querySelector('.completed-ink-layer')).not.toBeNull();
  });

  it('clears the transient trail and releases capture as soon as tools switch', () => {
    render(<BoardApp />);
    activateTool('Laser pointer');
    const surface = activeDrawingSurface();

    drawPointerEvent(surface, 'down', { x: 140, y: 180 }, 7);
    drawPointerEvent(surface, 'move', { x: 460, y: 300 }, 7);
    expect(document.querySelector('.laser-trail')).not.toBeNull();
    expect(capturedPointers.has(7)).toBe(true);
    expect(animationFrames.size).toBe(1);

    activateTool('Select');
    expect(
      screen.getByRole('button', { name: 'Laser pointer' }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(document.querySelector('.drawing-surface')).toBeNull();
    expect(document.querySelector('.laser-trail')).toBeNull();
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(animationFrames.size).toBe(0);
  });
});

describe('laser trail timing', () => {
  it('stays solid before fading and reaches zero at three seconds', () => {
    expect(laserTrailOpacity(0, 2100)).toBe(1);
    expect(laserTrailOpacity(0, 2550)).toBeCloseTo(0.5);
    expect(laserTrailOpacity(0, LASER_TRAIL_LIFETIME_MS)).toBe(0);
  });
});
