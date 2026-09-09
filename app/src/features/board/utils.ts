import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  HISTORY_LIMIT,
  MIN_ITEM_SIZE,
  getDrawingStylePreset,
} from './constants';
import type {
  BoardRect,
  CanvasItem,
  CanvasStroke,
  CanvasTransform,
  EraserPoint,
  EraserTrace,
  Point,
  ResizeCorner,
  SlideDeck,
  StrokePoint,
} from './types';

export const ERASER_MIN_RADIUS_PX = 8;
export const ERASER_MAX_RADIUS_PX = 28;

export type EraserSweep = {
  from: EraserPoint;
  to: EraserPoint;
};

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

export function eraserRadiusForVelocity(velocity: number) {
  const safeVelocity = Number.isFinite(velocity) ? Math.max(0, velocity) : 0;
  const normalized = clamp((safeVelocity - 0.08) / (1.2 - 0.08), 0, 1);
  const eased = normalized * normalized * (3 - 2 * normalized);

  return (
    ERASER_MIN_RADIUS_PX +
    (ERASER_MAX_RADIUS_PX - ERASER_MIN_RADIUS_PX) * eased
  );
}

function pointDistance(first: Point, second: Point) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function interpolatePoint(first: Point, second: Point, amount: number): Point {
  return {
    x: first.x + (second.x - first.x) * amount,
    y: first.y + (second.y - first.y) * amount,
  };
}

function appendLineSamples(
  samples: Point[],
  from: Point,
  to: Point,
  spacing = 3,
) {
  const divisions = Math.max(1, Math.ceil(pointDistance(from, to) / spacing));
  for (let step = 1; step <= divisions; step += 1) {
    samples.push(interpolatePoint(from, to, step / divisions));
  }
}

function flattenedStrokeCenterline(stroke: CanvasStroke) {
  const points = stroke.points;
  if (points.length <= 1) return points.map(({ x, y }) => ({ x, y }));
  if (points.length === 2) {
    const samples: Point[] = [{ x: points[0].x, y: points[0].y }];
    appendLineSamples(samples, points[0], points[1]);
    return samples;
  }

  const samples: Point[] = [{ x: points[0].x, y: points[0].y }];
  let segmentStart: Point = points[0];

  for (let index = 1; index < points.length - 1; index += 1) {
    const control = points[index];
    const following = points[index + 1];
    const segmentEnd = {
      x: (control.x + following.x) / 2,
      y: (control.y + following.y) / 2,
    };
    const estimatedLength =
      pointDistance(segmentStart, control) + pointDistance(control, segmentEnd);
    const divisions = Math.max(1, Math.ceil(estimatedLength / 3));

    for (let step = 1; step <= divisions; step += 1) {
      const amount = step / divisions;
      const inverse = 1 - amount;
      samples.push({
        x:
          inverse * inverse * segmentStart.x +
          2 * inverse * amount * control.x +
          amount * amount * segmentEnd.x,
        y:
          inverse * inverse * segmentStart.y +
          2 * inverse * amount * control.y +
          amount * amount * segmentEnd.y,
      });
    }
    segmentStart = segmentEnd;
  }

  appendLineSamples(samples, segmentStart, points.at(-1)!);
  return samples;
}

function eraserJoinPolygon(from: EraserPoint, to: EraserPoint) {
  const horizontal = to.x - from.x;
  const vertical = to.y - from.y;
  const length = Math.hypot(horizontal, vertical);
  if (length < 0.000001) return null;

  const normalX = -vertical / length;
  const normalY = horizontal / length;
  return [
    {
      x: from.x + normalX * from.radius,
      y: from.y + normalY * from.radius,
    },
    { x: to.x + normalX * to.radius, y: to.y + normalY * to.radius },
    { x: to.x - normalX * to.radius, y: to.y - normalY * to.radius },
    {
      x: from.x - normalX * from.radius,
      y: from.y - normalY * from.radius,
    },
  ];
}

function pointInsideConvexPolygon(point: Point, polygon: readonly Point[]) {
  let hasPositive = false;
  let hasNegative = false;

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const cross =
      (end.x - start.x) * (point.y - start.y) -
      (end.y - start.y) * (point.x - start.x);
    if (cross > 0.000001) hasPositive = true;
    else if (cross < -0.000001) hasNegative = true;
    if (hasPositive && hasNegative) return false;
  }

  return true;
}

function pointInsideEraserSweep(point: Point, sweep: EraserSweep) {
  if (
    pointDistance(point, sweep.from) <= sweep.from.radius ||
    pointDistance(point, sweep.to) <= sweep.to.radius
  ) {
    return true;
  }

  const join = eraserJoinPolygon(sweep.from, sweep.to);
  return join ? pointInsideConvexPolygon(point, join) : false;
}

function pointInsideEraserTrace(point: Point, trace: EraserTrace) {
  if (
    trace.points.some(
      (tracePoint) => pointDistance(point, tracePoint) <= tracePoint.radius,
    )
  ) {
    return true;
  }

  return trace.points
    .slice(1)
    .some((tracePoint, index) => {
      const join = eraserJoinPolygon(trace.points[index], tracePoint);
      return join ? pointInsideConvexPolygon(point, join) : false;
    });
}

function strokeHasVisibleInkInSweep(
  stroke: CanvasStroke,
  centerline: readonly Point[],
  visualWidth: number,
  sweep: EraserSweep,
) {
  const halfWidth = visualWidth / 2;
  const existingErasures = stroke.erasures ?? [];
  const isNewlyErased = (point: Point) =>
    pointInsideEraserSweep(point, sweep) &&
    !existingErasures.some((trace) => pointInsideEraserTrace(point, trace));

  for (let index = 0; index < centerline.length; index += 1) {
    const center = centerline[index];
    const previous = centerline[Math.max(0, index - 1)];
    const following = centerline[Math.min(centerline.length - 1, index + 1)];
    const horizontal = following.x - previous.x;
    const vertical = following.y - previous.y;
    const tangentLength = Math.hypot(horizontal, vertical);

    if (tangentLength < 0.000001) {
      if (isNewlyErased(center)) return true;
      const rings = Math.max(1, Math.ceil(halfWidth / 2));
      for (let ring = 1; ring <= rings; ring += 1) {
        const radius = (halfWidth * ring) / rings;
        for (let step = 0; step < 16; step += 1) {
          const angle = (step / 16) * Math.PI * 2;
          if (
            isNewlyErased({
              x: center.x + Math.cos(angle) * radius,
              y: center.y + Math.sin(angle) * radius,
            })
          ) {
            return true;
          }
        }
      }
      continue;
    }

    const normalX = -vertical / tangentLength;
    const normalY = horizontal / tangentLength;
    const divisions = Math.max(1, Math.ceil(visualWidth / 2));
    for (let step = 0; step <= divisions; step += 1) {
      const offset = -halfWidth + (visualWidth * step) / divisions;
      if (
        isNewlyErased({
          x: center.x + normalX * offset,
          y: center.y + normalY * offset,
        })
      ) {
        return true;
      }
    }
  }

  if (stroke.style === 'highlighter' || centerline.length < 2) return false;
  for (const endpoint of [centerline[0], centerline.at(-1)!]) {
    for (let step = 0; step < 16; step += 1) {
      const angle = (step / 16) * Math.PI * 2;
      if (
        isNewlyErased({
          x: endpoint.x + Math.cos(angle) * halfWidth,
          y: endpoint.y + Math.sin(angle) * halfWidth,
        })
      ) {
        return true;
      }
    }
  }

  return false;
}

function strokeIntersectsEraserSweep(
  stroke: CanvasStroke,
  sweep: EraserSweep,
) {
  if (stroke.points.length === 0) return false;

  const visualWidth =
    stroke.style === 'highlighter'
      ? 26
      : getDrawingStylePreset(stroke.style).strokeWidth;
  const padding = visualWidth / 2 + 0.75;
  const maximumRadius = Math.max(sweep.from.radius, sweep.to.radius);
  let minimumStrokeX = Number.POSITIVE_INFINITY;
  let maximumStrokeX = Number.NEGATIVE_INFINITY;
  let minimumStrokeY = Number.POSITIVE_INFINITY;
  let maximumStrokeY = Number.NEGATIVE_INFINITY;
  stroke.points.forEach((point) => {
    minimumStrokeX = Math.min(minimumStrokeX, point.x);
    maximumStrokeX = Math.max(maximumStrokeX, point.x);
    minimumStrokeY = Math.min(minimumStrokeY, point.y);
    maximumStrokeY = Math.max(maximumStrokeY, point.y);
  });
  const minimumSweepX = Math.min(sweep.from.x, sweep.to.x) - maximumRadius;
  const maximumSweepX = Math.max(sweep.from.x, sweep.to.x) + maximumRadius;
  const minimumSweepY = Math.min(sweep.from.y, sweep.to.y) - maximumRadius;
  const maximumSweepY = Math.max(sweep.from.y, sweep.to.y) + maximumRadius;

  if (
    maximumStrokeX + padding < minimumSweepX ||
    minimumStrokeX - padding > maximumSweepX ||
    maximumStrokeY + padding < minimumSweepY ||
    minimumStrokeY - padding > maximumSweepY
  ) {
    return false;
  }

  const centerline = flattenedStrokeCenterline(stroke);
  return strokeHasVisibleInkInSweep(stroke, centerline, visualWidth, sweep);
}

export function applyEraserTraceToItems(
  items: CanvasItem[],
  trace: EraserTrace,
  sweeps: readonly EraserSweep[],
) {
  if (trace.points.length === 0 || sweeps.length === 0) return items;

  let changed = false;
  const traceSnapshot: EraserTrace = {
    id: trace.id,
    points: trace.points.map((point) => ({ ...point })),
  };
  const nextItems = items.map((item) => {
    if (item.kind !== 'stroke') return item;

    const existingIndex = item.erasures?.findIndex(
      (erasure) => erasure.id === trace.id,
    ) ?? -1;
    if (
      existingIndex < 0 &&
      !sweeps.some((sweep) => strokeIntersectsEraserSweep(item, sweep))
    ) {
      return item;
    }

    changed = true;
    const erasures = [...(item.erasures ?? [])];
    if (existingIndex >= 0) erasures[existingIndex] = traceSnapshot;
    else erasures.push(traceSnapshot);
    return { ...item, erasures };
  });

  return changed ? nextItems : items;
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
