import { describe, expect, it } from 'vitest';

import type { CanvasTextBox } from './types';
import { resizedItem, resizedItemWidth } from './utils';

const box: CanvasTextBox = {
  alignment: 'left',
  color: 'charcoal',
  height: 80,
  id: 'text-1',
  kind: 'text-box',
  rotation: 0,
  scale: 1,
  style: 'normal',
  text: 'Text that wraps',
  width: 400,
  x: 400,
  y: 300,
};

describe('text box resize geometry', () => {
  it('changes only width from a side while holding the opposite edge', () => {
    const resized = resizedItemWidth(box, 'e', { x: 700, y: 300 }, 120);

    expect(resized.width).toBe(500);
    expect(resized.height).toBe(80);
    expect(resized.x - resized.width / 2).toBe(box.x - box.width / 2);
    expect(resized.scale).toBe(1);
  });

  it('supports a rotated side in local item coordinates', () => {
    const rotated = { ...box, rotation: 90 };
    const resized = resizedItemWidth(rotated, 'e', { x: 400, y: 600 }, 120);

    expect(resized.width).toBeCloseTo(500);
    expect(resized.x).toBeCloseTo(400);
    expect(resized.y).toBeCloseTo(350);
  });

  it('provides a proportional corner result for font scaling', () => {
    const resized = resizedItem(box, 'se', { x: 700, y: 360 }, true, 16);
    const ratio = resized.width / box.width;

    expect(ratio).toBeGreaterThan(1);
    expect(resized.height / box.height).toBeCloseTo(ratio);
    expect(box.scale * ratio).toBeGreaterThan(box.scale);
  });
});
