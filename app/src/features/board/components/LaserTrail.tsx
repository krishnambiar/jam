import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
} from 'react';

import { getDrawingColorValue } from '../constants';
import {
  LASER_TRAIL_LIFETIME_MS,
  laserTrailOpacity,
} from '../laserTrail';
import type { LaserPoint, LaserTrail } from '../types';
import { strokePath } from '../utils';

export type LaserTrailHandle = {
  appendPoints: (trailId: string, points: readonly LaserPoint[]) => void;
  clear: () => void;
  endTrail: (trailId: string, endedAt: number) => void;
  startTrail: (trailId: string, point: LaserPoint) => void;
};

type LaserTrailRun = {
  key: string;
  opacity: number;
  points: LaserPoint[];
};

const LASER_OPACITY_STEPS = 18;
const LASER_COLOR = getDrawingColorValue('red');
const LASER_POINT_MINIMUM_DISTANCE = 0.55;

function laserTrailRuns(points: readonly LaserPoint[], now: number) {
  const runs: LaserTrailRun[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const opacity = laserTrailOpacity(points[index].createdAt, now);
    if (opacity <= 0) continue;

    const steppedOpacity =
      Math.ceil(opacity * LASER_OPACITY_STEPS) / LASER_OPACITY_STEPS;
    const current = runs.at(-1);
    if (current?.opacity === steppedOpacity) {
      current.points.push(points[index + 1]);
      continue;
    }

    runs.push({
      key: `${points[index].createdAt}-${points[index].x}-${points[index].y}`,
      opacity: steppedOpacity,
      points: [points[index], points[index + 1]],
    });
  }

  return runs;
}

function appendLaserPoints(
  points: readonly LaserPoint[],
  candidates: readonly LaserPoint[],
): LaserPoint[] | null {
  const next = [...points];
  let previous = next.at(-1);
  let changed = false;
  const minimumDistanceSquared =
    LASER_POINT_MINIMUM_DISTANCE * LASER_POINT_MINIMUM_DISTANCE;

  candidates.forEach((candidate) => {
    if (previous) {
      const horizontal = candidate.x - previous.x;
      const vertical = candidate.y - previous.y;
      if (
        horizontal * horizontal + vertical * vertical <
        minimumDistanceSquared
      ) {
        if (candidate.createdAt > previous.createdAt) {
          next[next.length - 1] = candidate;
          previous = candidate;
          changed = true;
        }
        return;
      }
    }

    next.push(candidate);
    previous = candidate;
    changed = true;
  });

  return changed ? next : null;
}

export const LaserTrailLayer = forwardRef<LaserTrailHandle>(
  function LaserTrailLayer(_, ref) {
    const [, redraw] = useReducer((version: number) => version + 1, 0);
    const trailsRef = useRef<LaserTrail[]>([]);
    const activeTrailIdsRef = useRef<Set<string>>(new Set());
    const nowRef = useRef(performance.now());
    const animationFrameRef = useRef<number | null>(null);

    const animate = useCallback(
      function animateLaserTrails(now: number) {
        animationFrameRef.current = null;
        nowRef.current = now;
        trailsRef.current = trailsRef.current.flatMap((trail) => {
          let points = trail.points.filter(
            (point) => now - point.createdAt < LASER_TRAIL_LIFETIME_MS,
          );
          if (activeTrailIdsRef.current.has(trail.id)) {
            const lastPoint = trail.points.at(-1);
            if (lastPoint) {
              const activeTip = { ...lastPoint, createdAt: now };
              points =
                points.length > 0
                  ? [...points.slice(0, -1), activeTip]
                  : [activeTip];
            }
          }
          return points.length > 0 ? [{ ...trail, points }] : [];
        });
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
            trailsRef.current = [
              ...trailsRef.current,
              { id: trailId, points: [...candidates] },
            ];
          } else {
            const trail = trailsRef.current[trailIndex];
            const points = appendLaserPoints(trail.points, candidates);
            if (!points) return;
            const trails = [...trailsRef.current];
            trails[trailIndex] = { ...trail, points };
            trailsRef.current = trails;
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
          const lastPoint = trail.points.at(-1);
          if (!lastPoint) return;
          const trails = [...trailsRef.current];
          trails[trailIndex] = {
            ...trail,
            points: [
              ...trail.points.slice(0, -1),
              { ...lastPoint, createdAt: endedAt },
            ],
          };
          trailsRef.current = trails;
          nowRef.current = Math.max(nowRef.current, endedAt);
          redraw();
          ensureAnimation();
        },
        startTrail(trailId, point) {
          activeTrailIdsRef.current.add(trailId);
          trailsRef.current = [
            ...trailsRef.current.filter((trail) => trail.id !== trailId),
            { id: trailId, points: [point] },
          ];
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

    return trailsRef.current.map((trail) => {
      const now = nowRef.current;
      const lastPoint = trail.points.at(-1);
      if (!lastPoint) return null;

      const tipOpacity = laserTrailOpacity(lastPoint.createdAt, now);
      const runs = laserTrailRuns(trail.points, now);
      const tipPath = strokePath([lastPoint]);

      return (
        <g className="laser-trail" data-laser-trail={trail.id} key={trail.id}>
          {runs.map((run) => (
            <g
              className="laser-trail-run"
              data-opacity={run.opacity}
              key={run.key}
              opacity={run.opacity}
            >
              <path
                className="laser-trail-glow"
                d={strokePath(run.points)}
                fill="none"
                stroke={LASER_COLOR}
              />
              <path
                className="laser-trail-core"
                d={strokePath(run.points)}
                fill="none"
                stroke={LASER_COLOR}
              />
            </g>
          ))}
          {tipOpacity > 0 ? (
            <g className="laser-trail-tip" opacity={tipOpacity}>
              <path
                className="laser-trail-glow"
                d={tipPath}
                fill="none"
                stroke={LASER_COLOR}
              />
              <path
                className="laser-trail-core"
                d={tipPath}
                fill="none"
                stroke={LASER_COLOR}
              />
            </g>
          ) : null}
        </g>
      );
    });
  },
);
