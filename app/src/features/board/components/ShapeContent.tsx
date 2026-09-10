import type { CSSProperties } from 'react';

import { getShapeColorValue } from '../constants';
import type { ArrowDirection, ShapeColor, ShapeType } from '../types';

type ShapeContentProps = {
  arrowDirection?: ArrowDirection;
  color?: ShapeColor;
  filled?: boolean;
  icon?: boolean;
  shape: ShapeType;
};

export function ShapeContent({
  arrowDirection = 'right',
  color = 'charcoal',
  filled = true,
  icon = false,
  shape,
}: ShapeContentProps) {
  const palette = getShapeColorValue(color);
  const style = {
    '--shape-fill-color': icon || !filled ? 'none' : palette.fill,
    '--shape-stroke-color': icon ? '#3c4043' : palette.stroke,
  } as CSSProperties;
  const commonProps = {
    className: 'shape-geometry',
    vectorEffect: 'non-scaling-stroke' as const,
  };
  const edge = icon ? 6 : 0;
  const farEdge = icon ? 94 : 100;
  const diameter = farEdge - edge;

  if (shape === 'rounded-rectangle' && !icon) {
    return (
      <span
        className="shape-content shape-rounded-rectangle is-css-shape"
        aria-hidden="true"
        style={style}
      >
        <span className="rounded-rectangle-geometry" />
      </span>
    );
  }

  return (
    <svg
      className={`shape-content shape-${shape}${icon ? ' is-icon' : ''}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      {shape === 'circle' ? (
        <ellipse
          {...commonProps}
          cx="50"
          cy="50"
          rx={icon ? 44 : 50}
          ry={icon ? 44 : 50}
        />
      ) : shape === 'square' ? (
        <rect
          {...commonProps}
          x={edge}
          y={edge}
          width={diameter}
          height={diameter}
        />
      ) : shape === 'triangle' ? (
        <polygon
          {...commonProps}
          points={icon ? '50,5 95,94 5,94' : '50,0 100,100 0,100'}
        />
      ) : shape === 'diamond' ? (
        <polygon
          {...commonProps}
          points={
            icon ? '50,4 96,50 50,96 4,50' : '50,0 100,50 50,100 0,50'
          }
        />
      ) : shape === 'rounded-rectangle' ? (
        <rect
          {...commonProps}
          x={edge}
          y={edge}
          width={diameter}
          height={diameter}
          rx={icon ? 15 : 12}
          ry={icon ? 15 : 12}
        />
      ) : shape === 'half-circle' ? (
        <path
          {...commonProps}
          d={
            icon
              ? 'M 5 69 A 45 38 0 0 1 95 69 Z'
              : 'M 0 100 A 50 100 0 0 1 100 100 Z'
          }
        />
      ) : shape === 'rectangle' ? (
        <rect
          {...commonProps}
          x={edge}
          y={icon ? 31 : 0}
          width={diameter}
          height={icon ? 38 : 100}
        />
      ) : (
        <path
          {...commonProps}
          transform={
            arrowDirection === 'left'
              ? 'translate(100 0) scale(-1 1)'
              : undefined
          }
          d={
            icon
              ? 'M 5 31 H 61 V 13 L 95 50 L 61 87 V 69 H 5 Z'
              : 'M 0 25 H 61 V 0 L 100 50 L 61 100 V 75 H 0 Z'
          }
        />
      )}
    </svg>
  );
}
