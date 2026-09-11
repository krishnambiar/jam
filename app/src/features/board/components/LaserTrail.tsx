import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useReducer,
  useRef,
} from 'react';

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  getDrawingColorValue,
} from '../constants';
import {
  LASER_TRAIL_STROKE_WIDTH_PX,
  laserTrailBudgetLength,
  laserTrailCumulativeLengths,
  laserTrailJuiceOpacity,
  laserTrailOpacity,
  stageLaserTrailForRelease,
  trimLaserTrailsToLength,
} from '../laserTrail';
import type { LaserPoint, LaserTrail } from '../types';
import { strokePath } from '../utils';

export type LaserTrailHandle = {
  appendPoints: (trailId: string, points: readonly LaserPoint[]) => void;
  clear: () => void;
  endTrail: (trailId: string, endedAt: number) => void;
  startTrail: (trailId: string, point: LaserPoint) => void;
};

type LaserMaskBand = {
  end: number;
  opacity: number;
  start: number;
};

const LASER_COLOR = getDrawingColorValue('red');
const LASER_POINT_MINIMUM_DISTANCE = 4;
const LASER_POINT_MAXIMUM_SPACING = 12;
const LASER_MASK_OPACITY_STEPS = 96;
const LASER_MASK_STROKE_WIDTH_PX = LASER_TRAIL_STROKE_WIDTH_PX + 2;
const MASK_BOUNDS_PADDING = 20;
const LENGTH_EPSILON = 0.001;

function appendLaserPoints(
  points: readonly LaserPoint[],
  candidates: readonly LaserPoint[],
): LaserPoint[] | null {
  const next = [...points];
  let previous = next.at(-1);
  let changed = false;

  candidates.forEach((candidate) => {
    if (!previous) {
      next.push(candidate);
      previous = candidate;
      changed = true;
      return;
    }

    const distance = Math.hypot(
      candidate.x - previous.x,
      candidate.y - previous.y,
    );
    if (distance < LASER_POINT_MINIMUM_DISTANCE) {
      if (distance <= LENGTH_EPSILON) {
        if (candidate.createdAt <= previous.createdAt) return;
        next[next.length - 1] = candidate;
        previous = candidate;
        changed = true;
        return;
      }

      if (next.length === 1) {
        next.push(candidate);
        previous = candidate;
        changed = true;
        return;
      }

      const anchor = next[next.length - 2];
      const distanceFromAnchor = Math.hypot(
        candidate.x - anchor.x,
        candidate.y - anchor.y,
      );
      if (distanceFromAnchor < LASER_POINT_MINIMUM_DISTANCE) {
        next[next.length - 1] = candidate;
      } else {
        next.push(candidate);
      }
      previous = candidate;
      changed = true;
      return;
    }

    const start = previous;
    const sampleCount = Math.ceil(
      distance / LASER_POINT_MAXIMUM_SPACING,
    );
    for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
      const ratio = sampleIndex / sampleCount;
      const point =
        sampleIndex === sampleCount
          ? candidate
          : {
              x: start.x + (candidate.x - start.x) * ratio,
              y: start.y + (candidate.y - start.y) * ratio,
              createdAt:
                start.createdAt +
                (candidate.createdAt - start.createdAt) * ratio,
            };
      next.push(point);
      previous = point;
    }
    changed = true;
  });

  return changed ? next : null;
}

function visibleLaserPoints(
  points: readonly LaserPoint[],
  now: number,
  active: boolean,
) {
  if (points.length === 0) return [];

  const refreshedPoints = [...points];
  if (active) {
    const lastPoint = refreshedPoints.at(-1)!;
    refreshedPoints[refreshedPoints.length - 1] = {
      ...lastPoint,
      createdAt: now,
    };
  }

  const firstVisibleIndex = refreshedPoints.findIndex(
    (point) => laserTrailOpacity(point.createdAt, now) > 0,
  );
  if (firstVisibleIndex < 0) return [];

  // Keep one transparent predecessor so the age fade reaches zero along the
  // segment instead of making its geometry disappear at a sample boundary.
  return refreshedPoints.slice(Math.max(0, firstVisibleIndex - 1));
}

function appendMaskBand(
  bands: LaserMaskBand[],
  start: number,
  end: number,
  opacity: number,
) {
  if (end - start <= LENGTH_EPSILON || opacity <= 0.001) return;

  const roundedOpacity =
    Math.round(Math.min(1, opacity) * LASER_MASK_OPACITY_STEPS) /
    LASER_MASK_OPACITY_STEPS;
  if (roundedOpacity <= 0) return;
  const previous = bands.at(-1);
  if (
    previous &&
    Math.abs(previous.end - start) <= LENGTH_EPSILON &&
    previous.opacity === roundedOpacity
  ) {
    previous.end = end;
    return;
  }

  bands.push({ start, end, opacity: roundedOpacity });
}

function laserMaskBands(
  cumulativeLengths: readonly number[],
  pointOpacities: readonly number[],
) {
  const pathLength = cumulativeLengths.at(-1) ?? 0;
  if (pathLength <= LENGTH_EPSILON) {
    const opacity = pointOpacities.at(-1) ?? 0;
    return opacity > 0
      ? [{ start: 0, end: 0.01, opacity }]
      : [];
  }

  const bands: LaserMaskBand[] = [];
  for (let index = 0; index < cumulativeLengths.length - 1; index += 1) {
    const segmentStart = cumulativeLengths[index];
    const segmentEnd = cumulativeLengths[index + 1];
    const segmentLength = segmentEnd - segmentStart;
    if (segmentLength <= LENGTH_EPSILON) continue;

    const startOpacity = pointOpacities[index] ?? 0;
    const endOpacity = pointOpacities[index + 1] ?? 0;
    const subdivisions = Math.max(
      1,
      Math.ceil(
        Math.abs(endOpacity - startOpacity) *
          LASER_MASK_OPACITY_STEPS *
          2,
      ),
    );

    for (let step = 0; step < subdivisions; step += 1) {
      const startRatio = step / subdivisions;
      const endRatio = (step + 1) / subdivisions;
      const midpointRatio = (startRatio + endRatio) / 2;
      appendMaskBand(
        bands,
        segmentStart + segmentLength * startRatio,
        segmentStart + segmentLength * endRatio,
        startOpacity + (endOpacity - startOpacity) * midpointRatio,
      );
    }
  }
  return bands;
}

function bandDashArray(band: LaserMaskBand, pathLength: number) {
  const bandLength = Math.max(LENGTH_EPSILON, band.end - band.start);
  const trailingGap = pathLength + 1;
  return band.start <= LENGTH_EPSILON
    ? `${bandLength} ${trailingGap}`
    : `0 ${band.start} ${bandLength} ${trailingGap}`;
}

export const LaserTrailLayer = forwardRef<LaserTrailHandle>(
  function LaserTrailLayer(_, ref) {
    const [, redraw] = useReducer((version: number) => version + 1, 0);
    const maskIdPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const trailsRef = useRef<LaserTrail[]>([]);
    const activeTrailIdsRef = useRef<Set<string>>(new Set());
    const nowRef = useRef(performance.now());
    const animationFrameRef = useRef<number | null>(null);

    const animate = useCallback(
      function animateLaserTrails(now: number) {
        animationFrameRef.current = null;
        nowRef.current = now;
        trailsRef.current = trimLaserTrailsToLength(
          trailsRef.current.flatMap((trail) => {
            const points = visibleLaserPoints(
              trail.points,
              now,
              activeTrailIdsRef.current.has(trail.id),
            );
            return points.length > 0 ? [{ ...trail, points }] : [];
          }),
        );
        redraw();

        if (trailsRef.current.length > 0) {
          animationFrameRef.current = window.requestAnimationFrame(
            animateLaserTrails,
          );
        }
      },
      [redraw],
    );

    const ensureAnimation = useCallback(() => {
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = window.requestAnimationFrame(animate);
    }, [animate]);

    useImperativeHandle(
      ref,
      () => ({
        appendPoints(trailId, candidates) {
          if (candidates.length === 0) return;
          const trailIndex = trailsRef.current.findIndex(
            (trail) => trail.id === trailId,
          );

          if (trailIndex < 0) {
            const points = appendLaserPoints([], candidates);
            if (!points) return;
            trailsRef.current = trimLaserTrailsToLength([
              ...trailsRef.current,
              { id: trailId, points },
            ]);
          } else {
            const trail = trailsRef.current[trailIndex];
            const points = appendLaserPoints(trail.points, candidates);
            if (!points) return;
            const trails = [...trailsRef.current];
            trails[trailIndex] = { ...trail, points };
            trailsRef.current = trimLaserTrailsToLength(trails);
          }

          nowRef.current = Math.max(
            nowRef.current,
            candidates.at(-1)?.createdAt ?? nowRef.current,
          );
          redraw();
          ensureAnimation();
        },
        clear() {
          trailsRef.current = [];
          activeTrailIdsRef.current.clear();
          if (animationFrameRef.current !== null) {
            window.cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
          }
          redraw();
        },
        endTrail(trailId, endedAt) {
          activeTrailIdsRef.current.delete(trailId);
          const trailIndex = trailsRef.current.findIndex(
            (trail) => trail.id === trailId,
          );
          if (trailIndex < 0) return;
          const trail = trailsRef.current[trailIndex];
          if (trail.points.length === 0) return;
          const trails = [...trailsRef.current];
          trails[trailIndex] = {
            ...trail,
            points: stageLaserTrailForRelease(trail.points, endedAt),
          };
          trailsRef.current = trails;
          nowRef.current = Math.max(nowRef.current, endedAt);
          redraw();
          ensureAnimation();
        },
        startTrail(trailId, point) {
          activeTrailIdsRef.current.add(trailId);
          trailsRef.current = trimLaserTrailsToLength([
            ...trailsRef.current.filter((trail) => trail.id !== trailId),
            { id: trailId, points: [point] },
          ]);
          nowRef.current = Math.max(nowRef.current, point.createdAt);
          redraw();
          ensureAnimation();
        },
      }),
      [ensureAnimation, redraw],
    );

    useEffect(
      () => () => {
        if (animationFrameRef.current !== null) {
          window.cancelAnimationFrame(animationFrameRef.current);
        }
        trailsRef.current = [];
        activeTrailIdsRef.current.clear();
      },
      [],
    );

    const totalBudgetLength = trailsRef.current.reduce(
      (total, trail) => total + laserTrailBudgetLength(trail.points),
      0,
    );
    const newerLengthByTrailId = new Map<string, number>();
    let newerLength = 0;
    for (let index = trailsRef.current.length - 1; index >= 0; index -= 1) {
      const trail = trailsRef.current[index];
      newerLengthByTrailId.set(trail.id, newerLength);
      newerLength += laserTrailBudgetLength(trail.points);
    }

    return trailsRef.current.map((trail) => {
      const cumulativeLengths = laserTrailCumulativeLengths(trail.points);
      const geometryLength = cumulativeLengths.at(-1) ?? 0;
      const budgetLength = laserTrailBudgetLength(trail.points);
      const newerTrailLength = newerLengthByTrailId.get(trail.id) ?? 0;
      const pointOpacities = trail.points.map((point, index) => {
        const distanceAlongTrail = cumulativeLengths[index] ?? 0;
        const distanceFromTrailTip =
          geometryLength > LENGTH_EPSILON
            ? ((geometryLength - distanceAlongTrail) / geometryLength) *
              budgetLength
            : budgetLength / 2;
        return (
          laserTrailOpacity(point.createdAt, nowRef.current) *
          laserTrailJuiceOpacity(
            newerTrailLength + distanceFromTrailTip,
            totalBudgetLength,
          )
        );
      });
      const bands = laserMaskBands(cumulativeLengths, pointOpacities);
      if (bands.length === 0) return null;

      const pathData = strokePath(trail.points);
      const pathLength = Math.max(0.01, geometryLength);
      const firstPoint = trail.points[0];
      const lastPoint = trail.points.at(-1)!;
      const maskId = `laser-mask-${maskIdPrefix}-${trail.id.replace(
        /[^a-zA-Z0-9_-]/g,
        '',
      )}`;

      return (
        <g className="laser-trail" data-laser-trail={trail.id} key={trail.id}>
          <defs>
            <mask
              height={BOARD_HEIGHT + MASK_BOUNDS_PADDING * 2}
              id={maskId}
              maskUnits="userSpaceOnUse"
              style={{ maskType: 'alpha' }}
              width={BOARD_WIDTH + MASK_BOUNDS_PADDING * 2}
              x={-MASK_BOUNDS_PADDING}
              y={-MASK_BOUNDS_PADDING}
            >
              {bands.map((band, bandIndex) => (
                <g
                  className="laser-trail-mask-band"
                  key={bandIndex}
                  opacity={band.opacity}
                >
                  <path
                    className="laser-trail-mask-segment"
                    d={pathData}
                    fill="none"
                    pathLength={pathLength}
                    stroke="#fff"
                    strokeDasharray={bandDashArray(band, pathLength)}
                    strokeLinecap="butt"
                    strokeWidth={LASER_MASK_STROKE_WIDTH_PX}
                    vectorEffect="non-scaling-stroke"
                  />
                  {bandIndex === 0 && band.start <= LENGTH_EPSILON ? (
                    <path
                      className="laser-trail-mask-cap"
                      d={strokePath([firstPoint])}
                      fill="none"
                      stroke="#fff"
                      strokeLinecap="round"
                      strokeWidth={LASER_MASK_STROKE_WIDTH_PX}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                  {bandIndex === bands.length - 1 &&
                  band.end >= pathLength - LENGTH_EPSILON ? (
                    <path
                      className="laser-trail-mask-cap"
                      d={strokePath([lastPoint])}
                      fill="none"
                      stroke="#fff"
                      strokeLinecap="round"
                      strokeWidth={LASER_MASK_STROKE_WIDTH_PX}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                </g>
              ))}
            </mask>
          </defs>
          <path
            className="laser-trail-stroke"
            d={pathData}
            fill="none"
            mask={`url(#${maskId})`}
            pathLength={pathLength}
            stroke={LASER_COLOR}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={0.94}
            strokeWidth={LASER_TRAIL_STROKE_WIDTH_PX}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      );
    });
  },
);
