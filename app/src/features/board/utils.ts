import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  HISTORY_LIMIT,
  MIN_ITEM_SIZE,
} from './constants';
import type {
  BoardRect,
  CanvasItem,
  CanvasTransform,
  Point,
  ResizeCorner,
  SlideDeck,
  StrokePoint,
} from './types';

export function addToPast(past: CanvasItem[][], snapshot: CanvasItem[]) {
  return [...past, snapshot].slice(-HISTORY_LIMIT);
}

export function addDeckToPast(past: SlideDeck[], snapshot: SlideDeck) {
  return [...past, snapshot].slice(-HISTORY_LIMIT);
}

export function boardPoint(
  clientX: number,
  clientY: number,
  rect: BoardRect,
): Point {
  return {
    x: ((clientX - rect.left) / rect.width) * BOARD_WIDTH,
    y: ((clientY - rect.top) / rect.height) * BOARD_HEIGHT,
  };
}

export function appendStrokePoints(
  points: StrokePoint[],
  candidates: StrokePoint[],
  minimumDistance = 0.55,
) {
  let appended = false;
  let previous = points.at(-1);
  const minimumDistanceSquared = minimumDistance * minimumDistance;

  for (const candidate of candidates) {
    if (previous) {
      const deltaX = candidate.x - previous.x;
      const deltaY = candidate.y - previous.y;
      if (deltaX * deltaX + deltaY * deltaY < minimumDistanceSquared) continue;
    }

    points.push(candidate);
    previous = candidate;
    appended = true;
  }

  return appended;
}

function pathNumber(value: number) {
  return Math.round(value * 100) / 100;
}

export function strokePath(points: readonly Point[]) {
  if (points.length === 0) return '';

  const first = points[0];
  if (points.length === 1) {
    return `M ${pathNumber(first.x)} ${pathNumber(first.y)} l 0.01 0`;
  }
  if (points.length === 2) {
    const last = points[1];
    return `M ${pathNumber(first.x)} ${pathNumber(first.y)} L ${pathNumber(last.x)} ${pathNumber(last.y)}`;
  }

  const commands = [`M ${pathNumber(first.x)} ${pathNumber(first.y)}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const following = points[index + 1];
    commands.push(
      `Q ${pathNumber(point.x)} ${pathNumber(point.y)} ${pathNumber((point.x + following.x) / 2)} ${pathNumber((point.y + following.y) / 2)}`,
    );
  }

  const last = points.at(-1)!;
  commands.push(`L ${pathNumber(last.x)} ${pathNumber(last.y)}`);
  return commands.join(' ');
}

function rotateVector(point: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);

  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

export function clamp(value: number, minimum: number, maximum: number) {
  if (maximum < minimum) return (minimum + maximum) / 2;
  return Math.min(Math.max(value, minimum), maximum);
}

export function normalizeRotation(degrees: number) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

export function rotatedItemExtents(item: CanvasTransform) {
  const radians = (item.rotation * Math.PI) / 180;
  return {
    horizontal:
      (Math.abs(Math.cos(radians)) * item.width +
        Math.abs(Math.sin(radians)) * item.height) /
      2,
    vertical:
      (Math.abs(Math.sin(radians)) * item.width +
        Math.abs(Math.cos(radians)) * item.height) /
      2,
  };
}

export function resizedItem<T extends CanvasTransform>(
  item: T,
  corner: ResizeCorner,
  pointer: Point,
): T {
  const horizontalSign = corner.endsWith('e') ? 1 : -1;
  const verticalSign = corner.startsWith('s') ? 1 : -1;
  const aspectRatio = item.width / item.height;
  const fixedOffset = rotateVector(
    {
      x: (-horizontalSign * item.width) / 2,
      y: (-verticalSign * item.height) / 2,
    },
    item.rotation,
  );
  const fixedCorner = {
    x: item.x + fixedOffset.x,
    y: item.y + fixedOffset.y,
  };
  const pointerFromFixed = rotateVector(
    { x: pointer.x - fixedCorner.x, y: pointer.y - fixedCorner.y },
    -item.rotation,
  );
  const diagonal = {
    x: horizontalSign * aspectRatio,
    y: verticalSign,
  };
  const projectedHeight =
    (pointerFromFixed.x * diagonal.x + pointerFromFixed.y * diagonal.y) /
    (diagonal.x * diagonal.x + diagonal.y * diagonal.y);
  const minimumHeight = Math.max(MIN_ITEM_SIZE, MIN_ITEM_SIZE / aspectRatio);
  const nextHeight = clamp(projectedHeight, minimumHeight, BOARD_HEIGHT * 2);
  const nextWidth = nextHeight * aspectRatio;
  const draggedOffset = rotateVector(
    {
      x: horizontalSign * nextWidth,
      y: verticalSign * nextHeight,
    },
    item.rotation,
  );
  const draggedCorner = {
    x: fixedCorner.x + draggedOffset.x,
    y: fixedCorner.y + draggedOffset.y,
  };

  return {
    ...item,
    x: (fixedCorner.x + draggedCorner.x) / 2,
    y: (fixedCorner.y + draggedCorner.y) / 2,
    width: nextWidth,
    height: nextHeight,
  };
}

export function stickyNoteFontScale(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 19;

  const characterCount = Array.from(trimmed).length;
  const longestLine = Math.max(
    1,
    ...trimmed.split(/\r?\n/).map((line) => Array.from(line).length),
  );
  const contentScale =
    characterCount <= 3
      ? 48
      : characterCount <= 12
        ? 20
        : characterCount <= 26
          ? 16
          : characterCount <= 45
            ? 13
            : characterCount <= 75
              ? 10.5
              : 8.5;
  const lineFitScale = 90 / (longestLine * 0.56);

  return Math.max(8.5, Math.min(contentScale, lineFitScale));
}

export function fittedImageSize(naturalWidth: number, naturalHeight: number) {
  const maxWidth = BOARD_WIDTH * 0.42;
  const maxHeight = BOARD_HEIGHT * 0.48;
  let scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);
  const longestSide = Math.max(naturalWidth, naturalHeight) * scale;

  if (longestSide < 120) {
    scale *= 120 / longestSide;
  }

  return {
    width: naturalWidth * scale,
    height: naturalHeight * scale,
  };
}

export function isTextEntry(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function decodeImageFile(file: File) {
  return new Promise<{
    src: string;
    name: string;
    naturalWidth: number;
    naturalHeight: number;
  }>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('The clipboard file could not be read.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('The clipboard file was not an image.'));
        return;
      }

      const image = new Image();
      image.onerror = () => reject(new Error('The image format could not be decoded.'));
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error('The image has no visible dimensions.'));
          return;
        }

        resolve({
          src: reader.result as string,
          name: file.name || 'Pasted image',
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
