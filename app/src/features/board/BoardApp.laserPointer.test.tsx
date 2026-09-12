import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BoardApp from './BoardApp';
import {
  LASER_TRAIL_LIFETIME_MS,
  LASER_TRAIL_MAX_LENGTH,
  LASER_TRAIL_RELEASE_MS,
  LASER_TRAIL_STROKE_WIDTH_PX,
  laserTrailBudgetLength,
  laserTrailJuiceOpacity,
  laserTrailOpacity,
  laserTrailReleaseOpacity,
  trimLaserTrailsToLength,
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

function renderedLaserTrailCount() {
  return new Set(
    Array.from(
      document.querySelectorAll<SVGGElement>('.laser-trail-band'),
    ).map((band) => band.dataset.laserTrail),
  ).size;
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

      const stroke = document.querySelector<SVGPathElement>(
        '.laser-trail-segment',
      );
      const fill = document.querySelector<SVGRectElement>(
        '.laser-trail-fill',
      );
      expect(stroke).not.toBeNull();
      expect(stroke).toHaveAttribute('stroke', 'rgb(255 255 255)');
      expect(stroke).toHaveAttribute(
        'stroke-width',
        String(LASER_TRAIL_STROKE_WIDTH_PX),
      );
      expect(stroke).toHaveAttribute('vector-effect', 'non-scaling-stroke');
      expect(stroke?.getAttribute('d')).toContain('Q');
      expect(document.querySelectorAll('.laser-trail-segment')).toHaveLength(1);
      expect(document.querySelector('.laser-trail-band')).not.toBeNull();
      expect(document.querySelectorAll('mask')).toHaveLength(1);
      expect(fill).toHaveAttribute('fill', '#dd4f44');
      expect(fill).toHaveAttribute('mask');
      expect(fill).toHaveAttribute('opacity', '0.94');
      expect(
        document.querySelector(
          '.laser-trail-tip, .laser-trail-run, .laser-trail-glow, .laser-trail-core',
        ),
      ).toBeNull();
      expect(document.querySelector('.laser-trail-layer circle')).toBeNull();

      drawPointerEvent(surface, 'up', { x: 500, y: 300 }, 1, pointerType);
      expect(document.querySelector('.laser-trail-fill')).not.toBeNull();
      expect(document.querySelector('.completed-ink-layer')).toBeNull();
    },
  );

  it('accumulates tiny stylus movements into a continuous trail', () => {
    render(<BoardApp />);
    activateTool('Laser pointer');
    const surface = activeDrawingSurface();

    drawPointerEvent(surface, 'down', { x: 100, y: 100 }, 2, 'pen');
    for (let x = 101; x <= 180; x += 1) {
      drawPointerEvent(surface, 'move', { x, y: 100 }, 2, 'pen');
    }

    const pathData = document
      .querySelector<SVGPathElement>('.laser-trail-segment')
      ?.getAttribute('d');
    expect(pathData).toContain('M 100 100');
    expect(pathData).toContain('180 100');
    expect(pathData).toContain('Q');
  });

  it('begins fading from the back on the first frame after release', () => {
    render(<BoardApp />);
    activateTool('Laser pointer');
    const surface = activeDrawingSurface();

    drawPointerEvent(surface, 'down', { x: 100, y: 100 });
    setClock(50);
    drawPointerEvent(surface, 'move', { x: 500, y: 100 });
    const activeBands = Array.from(
      document.querySelectorAll<SVGGElement>('.laser-trail-band'),
    );
    expect(activeBands.length).toBeGreaterThan(0);
    expect(
      activeBands.every(
        (band) => Number(band.dataset.laserOpacity) === 1,
      ),
    ).toBe(true);

    setClock(100);
    drawPointerEvent(surface, 'up', { x: 500, y: 100 });
    runAnimationFrame(116);

    const releasedOpacities = Array.from(
      document.querySelectorAll<SVGGElement>('.laser-trail-band'),
    ).map((band) => Number(band.dataset.laserOpacity));
    expect(releasedOpacities.length).toBeGreaterThan(1);
    expect(releasedOpacities[0]).toBeLessThan(1);
    expect(releasedOpacities.at(-1)).toBe(1);
    expect(
      releasedOpacities.every(
        (opacity, index) =>
          index === 0 || opacity >= releasedOpacities[index - 1],
      ),
    ).toBe(true);
    expect(
      document.querySelector('[data-laser-cap="head"]'),
    ).not.toBeNull();

    runAnimationFrame(100 + LASER_TRAIL_RELEASE_MS / 2);
    const firstVisibleSegment = document.querySelector<SVGPathElement>(
      '.laser-trail-segment',
    );
    const firstVisibleDistance = Number(
      firstVisibleSegment
        ?.getAttribute('stroke-dasharray')
        ?.split(' ')[1],
    );
    expect(firstVisibleDistance).toBeGreaterThan(195);
    expect(firstVisibleDistance).toBeLessThan(210);

    const halfwayOpacities = Array.from(
      document.querySelectorAll<SVGGElement>('.laser-trail-band'),
    ).map((band) => Number(band.dataset.laserOpacity));
    expect(halfwayOpacities[0]).toBeLessThan(0.1);
    expect(halfwayOpacities.at(-1)).toBe(1);

    runAnimationFrame(100 + LASER_TRAIL_RELEASE_MS * 0.75);
    expect(document.querySelector('.laser-trail-segment')).not.toBeNull();
    expect(
      document.querySelector('[data-laser-cap="head"]'),
    ).not.toBeNull();
    const terminalOpacities = Array.from(
      document.querySelectorAll<SVGGElement>('.laser-trail-band'),
    ).map((band) => Number(band.dataset.laserOpacity));
    expect(Math.max(...terminalOpacities)).toBeLessThan(0.4);

    runAnimationFrame(100 + LASER_TRAIL_RELEASE_MS * 0.83);
    const lateBands = Array.from(
      document.querySelectorAll<SVGGElement>('.laser-trail-band'),
    );
    const finalBand = lateBands.at(-1);
    const finalSegment = finalBand?.querySelector<SVGPathElement>(
      '.laser-trail-segment',
    );
    const finalHead = finalBand?.querySelector<SVGPathElement>(
      '[data-laser-cap="head"]',
    );
    expect(lateBands.length).toBeGreaterThan(0);
    expect(
      Math.max(...lateBands.map((band) => Number(band.dataset.laserOpacity))),
    ).toBeLessThan(0.03);
    expect(finalHead).not.toBeNull();
    expect(finalHead?.getAttribute('stroke')).toBe(
      finalSegment?.getAttribute('stroke'),
    );
    expect(finalHead).toHaveAttribute(
      'stroke-width',
      String(LASER_TRAIL_STROKE_WIDTH_PX),
    );
    expect(document.querySelectorAll('.laser-trail-cap')).toHaveLength(1);
    lateBands.forEach((band) => {
      const expectedChannel = Math.round(
        Number(band.dataset.laserOpacity) * 255,
      );
      const expectedStroke = `rgb(${expectedChannel} ${expectedChannel} ${expectedChannel})`;
      const segment = band.querySelector('.laser-trail-segment');
      expect(segment).toHaveAttribute('stroke', expectedStroke);
      expect(segment).not.toHaveAttribute('opacity');
      expect(segment).not.toHaveAttribute('stroke-opacity');
    });

    runAnimationFrame(100 + LASER_TRAIL_RELEASE_MS * 0.85);
    expect(document.querySelector('.laser-trail-segment')).toBeNull();
    expect(document.querySelector('.laser-trail-band')).toBeNull();
    expect(document.querySelector('.laser-trail-cap')).toBeNull();
    expect(animationFrames.size).toBe(0);

    runAnimationFrame(100 + LASER_TRAIL_RELEASE_MS + 1);
    expect(document.querySelector('.laser-trail-fill')).toBeNull();
    expect(animationFrames.size).toBe(0);
  });

  it('clears a tap before release cleanup without leaving a dot', () => {
    render(<BoardApp />);
    activateTool('Laser pointer');
    const surface = activeDrawingSurface();

    drawPointerEvent(surface, 'down', { x: 240, y: 180 });
    setClock(100);
    drawPointerEvent(surface, 'up', { x: 240, y: 180 });

    runAnimationFrame(116);
    expect(document.querySelector('.laser-trail-segment')).not.toBeNull();
    expect(
      document.querySelector('[data-laser-cap="head"]'),
    ).not.toBeNull();

    runAnimationFrame(100 + LASER_TRAIL_RELEASE_MS / 2);
    expect(document.querySelector('.laser-trail-segment')).not.toBeNull();

    runAnimationFrame(100 + LASER_TRAIL_RELEASE_MS * 0.6);
    expect(document.querySelector('.laser-trail-segment')).toBeNull();
    expect(document.querySelector('.laser-trail-band')).toBeNull();
    expect(document.querySelector('.laser-trail-cap')).toBeNull();

    runAnimationFrame(100 + LASER_TRAIL_RELEASE_MS + 1);
    expect(animationFrames.size).toBe(0);
  });

  it('does not re-expose an erased branch where the trail crosses itself', () => {
    render(<BoardApp />);
    activateTool('Laser pointer');
    const surface = activeDrawingSurface();

    drawPointerEvent(surface, 'down', { x: 200, y: 200 });
    setClock(10);
    drawPointerEvent(surface, 'move', { x: 100, y: 100 });
    setClock(20);
    drawPointerEvent(surface, 'move', { x: 100, y: 300 });
    setClock(30);
    drawPointerEvent(surface, 'move', { x: 300, y: 100 });
    setClock(40);
    drawPointerEvent(surface, 'move', { x: 300, y: 300 });
    setClock(50);
    drawPointerEvent(surface, 'up', { x: 300, y: 300 });

    runAnimationFrame(50 + LASER_TRAIL_RELEASE_MS * 0.35);

    const bands = Array.from(
      document.querySelectorAll<SVGGElement>('.laser-trail-band'),
    ).map((band) => ({
      end: Number(band.dataset.laserEnd),
      start: Number(band.dataset.laserStart),
    }));
    const laterCrossingDistance =
      Math.hypot(100, 100) + 200 + Math.hypot(100, 100);

    expect(bands.length).toBeGreaterThan(0);
    expect(bands.every((band) => band.start > 0)).toBe(true);
    expect(
      bands.some(
        (band) =>
          band.start <= laterCrossingDistance &&
          band.end >= laterCrossingDistance,
      ),
    ).toBe(true);
    const mask = document.querySelector<SVGMaskElement>('mask');
    expect(document.querySelectorAll('mask')).toHaveLength(1);
    expect(mask?.style.getPropertyValue('mask-type')).toBe('luminance');
    expect(
      document.querySelectorAll('.laser-trail-fill[mask]'),
    ).toHaveLength(1);
    expect(
      document.querySelector('.laser-trail-band[mask], .laser-trail-band [mask]'),
    ).toBeNull();
    expect(document.querySelector('[data-laser-cap="tail"]')).toBeNull();
    const headCaps = document.querySelectorAll<SVGPathElement>(
      '[data-laser-cap="head"]',
    );
    expect(headCaps).toHaveLength(1);
    expect(headCaps[0].getAttribute('d')).toContain('M 300 300');
    const segments = Array.from(
      document.querySelectorAll<SVGPathElement>('.laser-trail-segment'),
    );
    expect(segments).toHaveLength(bands.length);
    segments.forEach((segment) => {
      expect(segment.getAttribute('stroke') ?? '').toMatch(
        /^rgb\((\d+) \1 \1\)$/,
      );
      expect(segment).toHaveAttribute('stroke-dasharray');
      expect(segment).not.toHaveAttribute('opacity');
      expect(segment).not.toHaveAttribute('stroke-opacity');
    });
    Array.from(
      document.querySelectorAll<SVGPathElement>('.laser-trail-cap'),
    ).forEach((cap) => {
      expect(cap).not.toHaveAttribute('opacity');
      expect(cap).not.toHaveAttribute('stroke-opacity');
    });
    expect(
      Array.from(
        document.querySelectorAll<SVGGElement>('.laser-trail-band'),
      ).every((band) => !band.hasAttribute('opacity')),
    ).toBe(true);
    expect(
      Array.from(document.querySelectorAll<SVGPathElement>('path')).filter(
        (path) => path.getAttribute('stroke') === '#dd4f44',
      ),
    ).toHaveLength(0);
    expect(headCaps[0].getAttribute('stroke')).toBe(
      headCaps[0]
        .closest('.laser-trail-band')
        ?.querySelector('.laser-trail-segment')
        ?.getAttribute('stroke'),
    );
  });

  it('evaporates from the oldest end and quickly disappears after release', () => {
    render(<BoardApp />);
    activateTool('Laser pointer');
    const surface = activeDrawingSurface();

    drawPointerEvent(surface, 'down', { x: 100, y: 100 });
    setClock(1000);
    drawPointerEvent(surface, 'move', { x: 300, y: 200 });
    setClock(2200);
    drawPointerEvent(surface, 'move', { x: 500, y: 300 });
    expect(
      document.querySelector('.laser-trail-segment')?.getAttribute('d'),
    ).toContain('100 100');

    runAnimationFrame(3101);
    const remainingPath = document
      .querySelector<SVGPathElement>('.laser-trail-segment')
      ?.getAttribute('d');
    expect(remainingPath).not.toContain('100 100');
    expect(remainingPath).toContain('300 200');
    expect(remainingPath).toContain('500 300');

    drawPointerEvent(surface, 'up', { x: 500, y: 300 });
    runAnimationFrame(3101 + LASER_TRAIL_RELEASE_MS / 2);
    const fadingBands = Array.from(
      document.querySelectorAll<SVGGElement>('.laser-trail-band'),
    );
    expect(fadingBands.length).toBeGreaterThan(1);
    expect(
      Math.max(
        ...fadingBands.map((band) => Number(band.dataset.laserOpacity)),
      ),
    ).toBe(1);

    runAnimationFrame(3101 + LASER_TRAIL_RELEASE_MS + 1);
    expect(document.querySelector('.laser-trail-fill')).toBeNull();
    expect(animationFrames.size).toBe(0);
  });

  it('keeps the active tip visible while held and clears it if the window loses focus', () => {
    render(<BoardApp />);
    activateTool('Laser pointer');
    const surface = activeDrawingSurface();

    drawPointerEvent(surface, 'down', { x: 240, y: 180 }, 3);
    runAnimationFrame(LASER_TRAIL_LIFETIME_MS + 500);
    expect(document.querySelector('.laser-trail-segment')).not.toBeNull();
    expect(capturedPointers.has(3)).toBe(true);

    fireEvent(window, new Event('blur'));
    expect(document.querySelector('.laser-trail-fill')).toBeNull();
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

    setClock(LASER_TRAIL_RELEASE_MS / 2);
    drawPointerEvent(surface, 'down', { x: 100, y: 220 }, 5);
    drawPointerEvent(surface, 'move', { x: 280, y: 140 }, 5);
    drawPointerEvent(surface, 'up', { x: 360, y: 100 }, 5);
    expect(renderedLaserTrailCount()).toBe(2);
    expect(document.querySelectorAll('.laser-trail-fill')).toHaveLength(1);
    expect(document.querySelectorAll('mask')).toHaveLength(1);

    runAnimationFrame((LASER_TRAIL_RELEASE_MS * 2) / 3);
    const globalMaskOpacities = Array.from(
      document.querySelectorAll<SVGGElement>('.laser-trail-band'),
    ).map((band) => Number(band.dataset.laserOpacity));
    expect(
      globalMaskOpacities.every(
        (opacity, index) =>
          index === 0 || opacity >= globalMaskOpacities[index - 1],
      ),
    ).toBe(true);
    expect(
      new Set(
        Array.from(
          document.querySelectorAll<SVGGElement>('.laser-trail-band'),
        ).map((band) => band.dataset.laserTrail),
      ).size,
    ).toBe(2);

    runAnimationFrame(LASER_TRAIL_RELEASE_MS + 1);
    expect(renderedLaserTrailCount()).toBe(1);

    runAnimationFrame(LASER_TRAIL_RELEASE_MS * 1.5 + 1);
    expect(document.querySelector('.laser-trail-fill')).toBeNull();
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
    expect(document.querySelector('.laser-trail-fill')).not.toBeNull();
    expect(document.querySelector('.completed-ink-layer')).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(document.querySelector('.laser-trail-fill')).toBeNull();
    expect(document.querySelector('.completed-ink-layer')).not.toBeNull();
  });

  it('clears the transient trail and releases capture as soon as tools switch', () => {
    render(<BoardApp />);
    activateTool('Laser pointer');
    const surface = activeDrawingSurface();

    drawPointerEvent(surface, 'down', { x: 140, y: 180 }, 7);
    drawPointerEvent(surface, 'move', { x: 460, y: 300 }, 7);
    expect(document.querySelector('.laser-trail-fill')).not.toBeNull();
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
    expect(document.querySelector('.laser-trail-fill')).toBeNull();
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(animationFrames.size).toBe(0);
  });

  it('starts a smooth tail as soon as the shared pointer-juice budget fills', () => {
    render(<BoardApp />);
    activateTool('Laser pointer');
    const surface = activeDrawingSurface();

    drawPointerEvent(surface, 'down', { x: 100, y: 100 });
    drawPointerEvent(surface, 'move', { x: 1500, y: 100 });

    const stroke = document.querySelector<SVGPathElement>(
      '.laser-trail-segment',
    );
    const firstX = Number(
      stroke?.getAttribute('d')?.match(/^M ([\d.]+)/)?.[1],
    );
    expect(firstX).toBeCloseTo(1500 - LASER_TRAIL_MAX_LENGTH);
    expect(renderedLaserTrailCount()).toBe(1);

    const opacities = Array.from(
      document.querySelectorAll<SVGGElement>('.laser-trail-band'),
    ).map((band) => Number(band.dataset.laserOpacity));
    expect(opacities.length).toBeGreaterThan(20);
    expect(opacities.length).toBeLessThanOrEqual(97);
    expect(Math.min(...opacities)).toBeLessThan(0.1);
    expect(Math.max(...opacities)).toBe(1);
    expect(
      opacities.every(
        (opacity, index) => index === 0 || opacity >= opacities[index - 1],
      ),
    ).toBe(true);
    expect(
      opacities.every(
        (opacity, index) =>
          index === 0 || opacity - opacities[index - 1] <= 1 / 96 + 0.0001,
      ),
    ).toBe(true);
    expect(
      Array.from(
        document.querySelectorAll('.laser-trail-segment'),
      ).every((segment) => segment.getAttribute('stroke-linecap') === 'butt'),
    ).toBe(true);
  });
});

describe('laser trail evaporation', () => {
  it('stays solid before fading and reaches zero at three seconds', () => {
    expect(laserTrailOpacity(0, 1800)).toBe(1);
    expect(laserTrailOpacity(0, 2400)).toBeCloseTo(0.5);
    expect(laserTrailOpacity(0, LASER_TRAIL_LIFETIME_MS)).toBe(0);
  });

  it('grows a smooth spatial fade only after the solid budget is used', () => {
    expect(laserTrailJuiceOpacity(80, 80, 100, 20)).toBe(1);
    expect(laserTrailJuiceOpacity(80, 90, 100, 20)).toBe(1);
    expect(laserTrailJuiceOpacity(85, 90, 100, 20)).toBeCloseTo(0.5);
    expect(laserTrailJuiceOpacity(90, 90, 100, 20)).toBe(0);
    expect(laserTrailJuiceOpacity(90, 100, 100, 20)).toBeCloseTo(0.5);
    expect(laserTrailJuiceOpacity(100, 100, 100, 20)).toBe(0);
  });

  it('uses a fast localized release front instead of fading the whole trail', () => {
    const halfway = LASER_TRAIL_RELEASE_MS / 2;

    expect(laserTrailReleaseOpacity(0, 400, 0)).toBe(1);
    const firstFrameTail = laserTrailReleaseOpacity(0, 400, 16);
    expect(firstFrameTail).toBeGreaterThan(0);
    expect(firstFrameTail).toBeLessThan(1);
    expect(laserTrailReleaseOpacity(0, 400, halfway)).toBe(0);
    expect(laserTrailReleaseOpacity(199, 400, halfway)).toBe(0);
    expect(laserTrailReleaseOpacity(200, 400, halfway)).toBe(0);
    expect(laserTrailReleaseOpacity(220, 400, halfway)).toBeCloseTo(0.5);
    expect(laserTrailReleaseOpacity(240, 400, halfway)).toBe(1);
    expect(laserTrailReleaseOpacity(400, 400, halfway)).toBe(1);
    expect(laserTrailReleaseOpacity(400, 400, LASER_TRAIL_RELEASE_MS)).toBe(0);
    expect(laserTrailReleaseOpacity(1, 1, 0)).toBe(1);
    expect(laserTrailReleaseOpacity(1, 1, halfway)).toBeCloseTo(0.5);

    const tapHalfwayOpacity = laserTrailReleaseOpacity(0, 0, halfway);
    expect(laserTrailReleaseOpacity(0, 0, 0)).toBe(1);
    expect(tapHalfwayOpacity).toBeGreaterThan(0);
    expect(tapHalfwayOpacity).toBeLessThan(1);
    expect(
      laserTrailReleaseOpacity(0, 0, LASER_TRAIL_RELEASE_MS * 0.6),
    ).toBe(0);

    const terminalHeadOpacity = laserTrailReleaseOpacity(
      400,
      400,
      LASER_TRAIL_RELEASE_MS * 0.75,
    );
    expect(terminalHeadOpacity).toBeGreaterThan(0);
    expect(terminalHeadOpacity).toBeLessThan(0.4);
    expect(
      laserTrailReleaseOpacity(
        400,
        400,
        LASER_TRAIL_RELEASE_MS * 0.85,
      ),
    ).toBe(0);
    expect(
      laserTrailReleaseOpacity(
        LASER_TRAIL_MAX_LENGTH,
        LASER_TRAIL_MAX_LENGTH,
        LASER_TRAIL_RELEASE_MS * 0.85,
      ),
    ).toBe(0);
  });

  it('interpolates the exact global cutoff regardless of sample density', () => {
    const newerTrail = {
      id: 'newer',
      points: [
        { x: 0, y: 20, createdAt: 1 },
        { x: 80, y: 20, createdAt: 1 },
      ],
    };
    const sparse = trimLaserTrailsToLength(
      [
        {
          id: 'older',
          points: [
            { x: 0, y: 0, createdAt: 0 },
            { x: 80, y: 0, createdAt: 0 },
          ],
        },
        newerTrail,
      ],
      100,
    );
    const dense = trimLaserTrailsToLength(
      [
        {
          id: 'older',
          points: [0, 20, 40, 60, 80].map((x) => ({
            x,
            y: 0,
            createdAt: 0,
          })),
        },
        newerTrail,
      ],
      100,
    );

    expect(sparse).toHaveLength(2);
    expect(dense).toHaveLength(2);
    expect(sparse[0].points[0].x).toBeCloseTo(60);
    expect(dense[0].points[0].x).toBeCloseTo(60);
    expect(sparse[0].points.at(-1)?.x).toBe(80);
    expect(dense[0].points.at(-1)?.x).toBe(80);
  });

  it('never exceeds the global budget at a very short cutoff', () => {
    const trails = trimLaserTrailsToLength(
      [
        {
          id: 'older',
          points: [
            { x: 0, y: 0, createdAt: 0 },
            { x: 100, y: 0, createdAt: 0 },
          ],
        },
        {
          id: 'newer',
          points: [
            { x: 0, y: 20, createdAt: 1 },
            { x: 98, y: 20, createdAt: 1 },
          ],
        },
      ],
      100,
    );

    expect(trails).toHaveLength(2);
    expect(trails[0].points[0].x).toBeCloseTo(98);
    expect(
      trails.reduce(
        (total, trail) => total + laserTrailBudgetLength(trail.points),
        0,
      ),
    ).toBeCloseTo(100);
  });
});
