import {
  forwardRef,
  useId,
  useImperativeHandle,
  useReducer,
} from 'react';

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  getDrawingColorValue,
  getDrawingStylePreset,
} from '../constants';
import type { CanvasStroke, EraserPoint, StrokePoint } from '../types';
import { strokePath } from '../utils';

type InkStrokePathProps = {
  live?: boolean;
  stroke: CanvasStroke;
};

export type InkStrokeHandle = {
  redraw: () => void;
};

type DistanceInterval = {
  start: number;
  end: number;
};

type VelocityRun = DistanceInterval & {
  level: number;
};

const MARKER_FADE_LENGTH = 11;
const HIGHLIGHTER_OUTER_WIDTH = 26;
const HIGHLIGHTER_OUTER_ALPHA = 0.08;
const HIGHLIGHTER_BODY_ALPHA = 0.34;
const HIGHLIGHTER_BASE_ALPHA =
  1 - (1 - HIGHLIGHTER_OUTER_ALPHA) * (1 - HIGHLIGHTER_BODY_ALPHA);
const HIGHLIGHTER_LEVELS = 7;

function rounded(value: number) {
  return Math.round(value * 1000) / 1000;
}

function pathLength(points: readonly StrokePoint[]) {
  let length = 0;

  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  }

  return length;
}

function centeredDashArray(totalLength: number, trim: number) {
  const visibleLength = Math.max(0.01, totalLength - trim * 2);
  return `0 ${rounded(trim)} ${rounded(visibleLength)} ${rounded(totalLength + trim)}`;
}

function dashArrayForIntervals(
  totalLength: number,
  intervals: readonly DistanceInterval[],
) {
  if (intervals.length === 0) return undefined;
  if (
    intervals.length === 1 &&
    intervals[0].start <= 0.001 &&
    intervals[0].end >= totalLength - 0.001
  ) {
    return undefined;
  }

  const values: number[] = [];
  const first = intervals[0];
  if (first.start > 0.001) values.push(0, first.start);

  intervals.forEach((interval, index) => {
    values.push(Math.max(0.01, interval.end - interval.start));
    const next = intervals[index + 1];
    values.push(
      next
        ? Math.max(0.01, next.start - interval.end)
        : Math.max(0.01, totalLength - interval.end + totalLength),
    );
  });

  return values.map(rounded).join(' ');
}

function smoothstep(minimum: number, maximum: number, value: number) {
  const normalized = Math.min(
    1,
    Math.max(0, (value - minimum) / (maximum - minimum)),
  );
  return normalized * normalized * (3 - 2 * normalized);
}

function velocityRuns(points: readonly StrokePoint[]) {
  const segmentVelocities = points.slice(1).map((point) =>
    Number.isFinite(point.velocity) ? Math.max(0, point.velocity) : 0,
  );
  const smoothedVelocities = segmentVelocities.map((velocity, index) => {
    const previous = segmentVelocities[index - 1] ?? velocity;
    const following = segmentVelocities[index + 1] ?? velocity;
    return previous * 0.2 + velocity * 0.6 + following * 0.2;
  });
  const runs: VelocityRun[] = [];
  let distance = 0;

  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
    if (segmentLength <= 0.001) continue;

    const speed = smoothstep(0.18, 1.3, smoothedVelocities[index - 1]);
    const level = Math.round(speed * (HIGHLIGHTER_LEVELS - 1));
    const previousRun = runs.at(-1);

    if (previousRun?.level === level) {
      previousRun.end += segmentLength;
    } else {
      runs.push({
        level,
        start: distance,
        end: distance + segmentLength,
      });
    }
    distance += segmentLength;
  }

  return { runs, totalLength: distance };
}

function filterBounds(points: readonly StrokePoint[]) {
  const horizontal = points.map((point) => point.x);
  const vertical = points.map((point) => point.y);
  const padding = HIGHLIGHTER_OUTER_WIDTH;
  const minimumX = Math.min(...horizontal);
  const maximumX = Math.max(...horizontal);
  const minimumY = Math.min(...vertical);
  const maximumY = Math.max(...vertical);

  return {
    x: minimumX - padding,
    y: minimumY - padding,
    width: Math.max(1, maximumX - minimumX) + padding * 2,
    height: Math.max(1, maximumY - minimumY) + padding * 2,
  };
}

function stableSeed(value: string) {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) % 997;
  }
  return (hash % 89) + 1;
}

function eraserMaskPath(points: readonly EraserPoint[]) {
  const commands: string[] = [];

  points.slice(1).forEach((point, index) => {
    const from = points[index];
    const to = point;
    const horizontal = to.x - from.x;
    const vertical = to.y - from.y;
    const length = Math.hypot(horizontal, vertical);
    if (length < 0.001) return;

    const normalX = -vertical / length;
    const normalY = horizontal / length;
    commands.push(
      `M ${rounded(from.x + normalX * from.radius)} ${rounded(from.y + normalY * from.radius)}`,
      `L ${rounded(to.x + normalX * to.radius)} ${rounded(to.y + normalY * to.radius)}`,
      `L ${rounded(to.x - normalX * to.radius)} ${rounded(to.y - normalY * to.radius)}`,
      `L ${rounded(from.x - normalX * from.radius)} ${rounded(from.y - normalY * from.radius)} Z`,
    );
  });

  points.forEach((point) => {
    const radius = rounded(point.radius);
    commands.push(
      `M ${rounded(point.x + point.radius)} ${rounded(point.y)}`,
      `A ${radius} ${radius} 0 1 0 ${rounded(point.x - point.radius)} ${rounded(point.y)}`,
      `A ${radius} ${radius} 0 1 0 ${rounded(point.x + point.radius)} ${rounded(point.y)} Z`,
    );
  });

  return commands.join(' ');
}

function MarkerStroke({ live, stroke }: InkStrokePathProps) {
  const preset = getDrawingStylePreset(stroke.style);
  const color = getDrawingColorValue(stroke.color);
  const d = strokePath(stroke.points);
  const totalLength = pathLength(stroke.points);

  if (totalLength < 0.5) {
    return (
      <path
        className="ink-path ink-path-marker"
        d={d}
        fill="none"
        opacity={0.72}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={preset.strokeWidth}
      />
    );
  }

  if (live) {
    return (
      <path
        className="ink-path ink-path-marker"
        d={d}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={preset.strokeWidth}
      />
    );
  }

  const fadeLength = Math.min(MARKER_FADE_LENGTH, totalLength * 0.45);
  const fadeLayers = [
    { fraction: 0.18, opacity: (0.4 - 0.18) / (1 - 0.18) },
    { fraction: 0.38, opacity: (0.62 - 0.4) / (1 - 0.4) },
    { fraction: 0.6, opacity: (0.8 - 0.62) / (1 - 0.62) },
    { fraction: 0.8, opacity: (0.93 - 0.8) / (1 - 0.8) },
    { fraction: 1, opacity: 1 },
  ];

  return (
    <g className="ink-stroke ink-stroke-marker">
      <path
        className="ink-path ink-path-marker"
        d={d}
        fill="none"
        opacity={0.18}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={preset.strokeWidth}
      />
      {fadeLayers.map((layer) => (
        <path
          key={layer.fraction}
          className="ink-path ink-path-marker ink-path-marker-fade"
          d={d}
          fill="none"
          opacity={layer.opacity}
          pathLength={totalLength}
          stroke={color}
          strokeDasharray={centeredDashArray(
            totalLength,
            fadeLength * layer.fraction,
          )}
          strokeLinecap="butt"
          strokeLinejoin="round"
          strokeWidth={preset.strokeWidth}
        />
      ))}
    </g>
  );
}

function HighlighterStroke({ live, stroke }: InkStrokePathProps) {
  const preset = getDrawingStylePreset(stroke.style);
  const color = getDrawingColorValue(stroke.color);
  const d = strokePath(stroke.points);
  const drawnLength = pathLength(stroke.points);
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const filterId = `chalk-${instanceId}`;

  if (drawnLength < 0.5) {
    const point = stroke.points[0];
    const bounds = filterBounds(stroke.points);
    return (
      <>
        {live ? null : (
          <defs>
            <ChalkFilter
              bounds={bounds}
              filterId={filterId}
              seed={stableSeed(stroke.id)}
            />
          </defs>
        )}
        <rect
          className="ink-path ink-path-highlighter"
          x={point.x - preset.strokeWidth * 0.43}
          y={point.y - preset.strokeWidth * 0.19}
          width={preset.strokeWidth * 0.86}
          height={preset.strokeWidth * 0.38}
          rx={1.4}
          fill={color}
          filter={live ? undefined : `url(#${filterId})`}
          opacity={live ? 0.52 : 0.63}
          transform={`rotate(-18 ${point.x} ${point.y})`}
        />
      </>
    );
  }

  if (live) {
    return (
      <path
        className="ink-path ink-path-highlighter"
        d={d}
        fill="none"
        opacity={0.52}
        stroke={color}
        strokeLinecap="butt"
        strokeLinejoin="bevel"
        strokeWidth={preset.strokeWidth}
      />
    );
  }

  const { runs, totalLength } = velocityRuns(stroke.points);
  const bounds = filterBounds(stroke.points);

  const intervalsByLevel = Array.from(
    { length: HIGHLIGHTER_LEVELS },
    () => [] as DistanceInterval[],
  );
  runs.forEach((run) => {
    intervalsByLevel[run.level].push({ start: run.start, end: run.end });
  });

  return (
    <g className="ink-stroke ink-stroke-highlighter">
      <defs>
        <ChalkFilter
          bounds={bounds}
          filterId={filterId}
          seed={stableSeed(stroke.id)}
        />
      </defs>
      <g filter={`url(#${filterId})`}>
        <path
          className="ink-path ink-path-highlighter ink-path-highlighter-edge"
          d={d}
          fill="none"
          opacity={HIGHLIGHTER_OUTER_ALPHA}
          stroke={color}
          strokeLinecap="butt"
          strokeLinejoin="bevel"
          strokeWidth={HIGHLIGHTER_OUTER_WIDTH}
        />
        <path
          className="ink-path ink-path-highlighter ink-path-highlighter-body"
          d={d}
          fill="none"
          opacity={HIGHLIGHTER_BODY_ALPHA}
          stroke={color}
          strokeLinecap="butt"
          strokeLinejoin="bevel"
          strokeWidth={preset.strokeWidth}
        />
        {intervalsByLevel.map((intervals, level) => {
          if (intervals.length === 0) return null;
          const targetAlpha =
            0.63 - (0.14 * level) / (HIGHLIGHTER_LEVELS - 1);
          const overlayAlpha =
            (targetAlpha - HIGHLIGHTER_BASE_ALPHA) /
            (1 - HIGHLIGHTER_BASE_ALPHA);

          return (
            <path
              key={level}
              className="ink-path ink-path-highlighter ink-path-highlighter-velocity"
              d={d}
              fill="none"
              opacity={overlayAlpha}
              pathLength={totalLength}
              stroke={color}
              strokeDasharray={dashArrayForIntervals(
                totalLength,
                intervals,
              )}
              strokeLinecap="butt"
              strokeLinejoin="bevel"
              strokeWidth={preset.strokeWidth}
            />
          );
        })}
      </g>
    </g>
  );
}

type ChalkFilterProps = {
  bounds: ReturnType<typeof filterBounds>;
  filterId: string;
  seed: number;
};

function ChalkFilter({ bounds, filterId, seed }: ChalkFilterProps) {
  return (
    <filter
      id={filterId}
      x={bounds.x}
      y={bounds.y}
      width={bounds.width}
      height={bounds.height}
      colorInterpolationFilters="sRGB"
      filterUnits="userSpaceOnUse"
      primitiveUnits="userSpaceOnUse"
    >
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.025 0.14"
        numOctaves={2}
        seed={seed}
        result="noise"
      />
      <feColorMatrix
        in="noise"
        type="matrix"
        values="0 0 0 0 1
                0 0 0 0 1
                0 0 0 0 1
                0.055 0 0 0 0.94"
        result="grain"
      />
      <feComposite
        in="SourceGraphic"
        in2="grain"
        operator="in"
        result="textured"
      />
      <feDisplacementMap
        in="textured"
        in2="noise"
        scale={0.8}
        xChannelSelector="R"
        yChannelSelector="G"
        result="roughened"
      />
      <feGaussianBlur in="roughened" stdDeviation={0.24} />
    </filter>
  );
}

function StrokeArtwork({ live, stroke }: InkStrokePathProps) {
  if (stroke.style === 'marker') {
    return <MarkerStroke live={live} stroke={stroke} />;
  }
  if (stroke.style === 'highlighter') {
    return <HighlighterStroke live={live} stroke={stroke} />;
  }

  const preset = getDrawingStylePreset(stroke.style);
  return (
    <path
      className={`ink-path ink-path-${stroke.style}`}
      d={strokePath(stroke.points)}
      fill="none"
      opacity={preset.opacity}
      stroke={getDrawingColorValue(stroke.color)}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={preset.strokeWidth}
    />
  );
}

export const InkStrokePath = forwardRef<InkStrokeHandle, InkStrokePathProps>(
  function InkStrokePath({ live = false, stroke }, ref) {
    const [, redraw] = useReducer((version: number) => version + 1, 0);
    const maskId = `ink-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    useImperativeHandle(ref, () => ({ redraw }), [redraw]);

    if (!stroke.erasures?.length) {
      return <StrokeArtwork live={live} stroke={stroke} />;
    }

    return (
      <>
        <defs>
          <mask
            id={maskId}
            x={0}
            y={0}
            width={BOARD_WIDTH}
            height={BOARD_HEIGHT}
            maskUnits="userSpaceOnUse"
            maskContentUnits="userSpaceOnUse"
            style={{ maskType: 'luminance' }}
          >
            <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="#fff" />
            {stroke.erasures.map((trace) => (
              <path
                key={trace.id}
                d={eraserMaskPath(trace.points)}
                fill="#000"
              />
            ))}
          </mask>
        </defs>
        <g mask={`url(#${maskId})`}>
          <StrokeArtwork live={live} stroke={stroke} />
        </g>
      </>
    );
  },
);
