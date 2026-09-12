import type { LaserPoint, LaserTrail } from './types';

export const LASER_TRAIL_LIFETIME_MS = 3000;
export const LASER_TRAIL_FADE_MS = 1200;
export const LASER_TRAIL_MAX_LENGTH = 920;
export const LASER_TRAIL_FADE_LENGTH = 170;
export const LASER_TRAIL_STROKE_WIDTH_PX = 2.5;
export const LASER_TRAIL_RELEASE_MS = 600;
export const LASER_TRAIL_RELEASE_FEATHER_LENGTH = 80;
export const LASER_TRAIL_RELEASE_FADE_START = 0.6;
export const LASER_TRAIL_RELEASE_FADE_END = 0.85;

const LASER_TRAIL_TAP_LENGTH = 12;
const LENGTH_EPSILON = 0.001;

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number) {
  const unitValue = clampUnit(value);
  return unitValue * unitValue * (3 - 2 * unitValue);
}

export function laserTrailOpacity(createdAt: number, now: number) {
  const age = Math.max(0, now - createdAt);
  const fadeStart = LASER_TRAIL_LIFETIME_MS - LASER_TRAIL_FADE_MS;
  if (age >= LASER_TRAIL_LIFETIME_MS) return 0;
  if (age <= fadeStart) return 1;
  return (LASER_TRAIL_LIFETIME_MS - age) / LASER_TRAIL_FADE_MS;
}

export function laserPointDistance(start: LaserPoint, end: LaserPoint) {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

export function laserTrailCumulativeLengths(
  points: readonly LaserPoint[],
) {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(
      lengths[index - 1] +
        laserPointDistance(points[index - 1], points[index]),
    );
  }
  return lengths;
}

export function laserTrailLength(points: readonly LaserPoint[]) {
  return laserTrailCumulativeLengths(points).at(-1) ?? 0;
}

export function laserTrailReleaseOpacity(
  distanceFromTail: number,
  trailLength: number,
  elapsed: number,
  duration = LASER_TRAIL_RELEASE_MS,
  featherLength = LASER_TRAIL_RELEASE_FEATHER_LENGTH,
) {
  if (elapsed < 0) return 1;
  if (duration <= 0 || elapsed >= duration) return 0;

  const boundedLength = Math.max(0, trailLength);
  const progress = clampUnit(elapsed / duration);
  const isTap = boundedLength <= LENGTH_EPSILON;
  if (isTap) {
    const tapProgress = clampUnit(
      progress / LASER_TRAIL_RELEASE_FADE_START,
    );
    return 1 - smoothstep(tapProgress);
  }

  const boundedFeather = Math.min(
    boundedLength,
    Math.max(LENGTH_EPSILON, featherLength),
    Math.max(8, boundedLength * 0.1),
  );
  // Start one feather behind the tail so releasing does not make the first
  // pixels jump. The front then moves past the rounded head before cleanup.
  const eraseFront =
    progress * (boundedLength + boundedFeather * 2) - boundedFeather;
  const spatialOpacity = smoothstep(
    (distanceFromTail - eraseFront) / boundedFeather,
  );
  const terminalFadeProgress = clampUnit(
    (progress - LASER_TRAIL_RELEASE_FADE_START) /
      (LASER_TRAIL_RELEASE_FADE_END - LASER_TRAIL_RELEASE_FADE_START),
  );
  const terminalOpacity = 1 - smoothstep(terminalFadeProgress);
  return Math.min(spatialOpacity, terminalOpacity);
}

export function laserTrailBudgetLength(points: readonly LaserPoint[]) {
  const geometryLength = laserTrailLength(points);
  return geometryLength > LENGTH_EPSILON
    ? geometryLength
    : LASER_TRAIL_TAP_LENGTH;
}

/**
 * Opacity at a position measured back from the newest visible point. Short
 * trails stay solid. Once the shared juice budget enters its tail zone, the
 * oldest portion grows a smooth spatial fade even if it is still young.
 */
export function laserTrailJuiceOpacity(
  distanceFromNewest: number,
  totalLength: number,
  maxLength = LASER_TRAIL_MAX_LENGTH,
  fadeLength = LASER_TRAIL_FADE_LENGTH,
) {
  const boundedMaximum = Math.max(0, maxLength);
  if (boundedMaximum === 0) return 0;

  const visibleLength = Math.min(
    boundedMaximum,
    Math.max(0, totalLength),
  );
  if (distanceFromNewest > visibleLength + LENGTH_EPSILON) return 0;

  const boundedFadeLength = Math.min(
    boundedMaximum,
    Math.max(0, fadeLength),
  );
  const solidLength = boundedMaximum - boundedFadeLength;
  const activeFadeLength = Math.min(
    boundedFadeLength,
    Math.max(0, visibleLength - solidLength),
  );
  if (activeFadeLength <= LENGTH_EPSILON) return 1;

  const fadeStart = visibleLength - activeFadeLength;
  if (distanceFromNewest <= fadeStart) return 1;
  return smoothstep(
    (visibleLength - distanceFromNewest) / activeFadeLength,
  );
}

function interpolateLaserPoint(
  start: LaserPoint,
  end: LaserPoint,
  ratio: number,
): LaserPoint {
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
    createdAt: start.createdAt + (end.createdAt - start.createdAt) * ratio,
  };
}

function trimTrailToSuffix(
  points: readonly LaserPoint[],
  maximumLength: number,
) {
  const newest = points.at(-1);
  if (!newest || maximumLength <= 0) return [];
  if (points.length === 1) return [newest];

  const suffix = [newest];
  let retainedLength = 0;

  for (let index = points.length - 2; index >= 0; index -= 1) {
    const start = points[index];
    const end = points[index + 1];
    const segmentLength = laserPointDistance(start, end);
    const availableLength = maximumLength - retainedLength;
    if (availableLength <= LENGTH_EPSILON) break;

    if (segmentLength <= availableLength + LENGTH_EPSILON) {
      suffix.unshift(start);
      retainedLength += segmentLength;
      continue;
    }

    const ratioFromEnd = availableLength / segmentLength;
    suffix.unshift(interpolateLaserPoint(end, start, ratioFromEnd));
    break;
  }

  return suffix;
}

/**
 * Keeps the newest suffix of all gestures within one shared arc-length
 * budget. When the boundary crosses a segment, an exact interpolated cutoff
 * point keeps the tail moving continuously regardless of input sample rate.
 */
export function trimLaserTrailsToLength(
  trails: readonly LaserTrail[],
  maxLength = LASER_TRAIL_MAX_LENGTH,
): LaserTrail[] {
  let remainingLength = Math.max(0, maxLength);
  if (remainingLength === 0) return [];

  const retainedNewestFirst: LaserTrail[] = [];
  for (let index = trails.length - 1; index >= 0; index -= 1) {
    const trail = trails[index];
    const geometryLength = laserTrailLength(trail.points);
    const budgetLength = laserTrailBudgetLength(trail.points);

    if (budgetLength <= remainingLength + LENGTH_EPSILON) {
      retainedNewestFirst.push(trail);
      remainingLength = Math.max(0, remainingLength - budgetLength);
      continue;
    }

    if (geometryLength > remainingLength + LENGTH_EPSILON) {
      const points = trimTrailToSuffix(trail.points, remainingLength);
      if (points.length > 0) {
        retainedNewestFirst.push({ ...trail, points });
      }
    }
    break;
  }

  return retainedNewestFirst.reverse();
}
