import {
  Brush,
  Highlighter,
  PenLine,
  Pencil,
  type LucideIcon,
} from 'lucide-react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import { drawingColors, drawingStyles } from '../constants';
import type { DrawingColor, DrawingStyle } from '../types';

const drawingIcons: Record<DrawingStyle, LucideIcon> = {
  pen: PenLine,
  marker: Pencil,
  highlighter: Highlighter,
  brush: Brush,
};

type DrawingMenuProps = {
  color: DrawingColor;
  style: DrawingStyle;
  onColorChange: (color: DrawingColor) => void;
  onStyleChange: (style: DrawingStyle) => void;
};

function moveRadioFocus(event: ReactKeyboardEvent<HTMLButtonElement>) {
  const group = event.currentTarget.closest('[role="radiogroup"]');
  const choices = Array.from(
    group?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [],
  );
  let nextIndex = choices.indexOf(event.currentTarget);
  const columns = Number(group?.getAttribute('data-grid-columns') ?? 0);

  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = choices.length - 1;
  else if (columns > 0 && choices.length > columns) {
    const row = Math.floor(nextIndex / columns);
    const column = nextIndex % columns;
    const rows = Math.ceil(choices.length / columns);

    if (event.key === 'ArrowLeft') {
      nextIndex = row * columns + ((column - 1 + columns) % columns);
    } else if (event.key === 'ArrowRight') {
      nextIndex = row * columns + ((column + 1) % columns);
    } else if (event.key === 'ArrowUp') {
      nextIndex = ((row - 1 + rows) % rows) * columns + column;
    } else if (event.key === 'ArrowDown') {
      nextIndex = ((row + 1) % rows) * columns + column;
    } else {
      return;
    }
  } else if (
    (event.key === 'ArrowLeft' ||
      event.key === 'ArrowUp' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowDown') &&
    choices.length > 0
  ) {
    const direction =
      event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    nextIndex = (nextIndex + direction + choices.length) % choices.length;
  } else {
    return;
  }

  event.preventDefault();
  choices[nextIndex]?.focus();
  choices[nextIndex]?.click();
}

export function DrawingMenu({
  color,
  style,
  onColorChange,
  onStyleChange,
}: DrawingMenuProps) {
  return (
    <div
      id="drawing-options"
      className="drawing-menu"
      role="group"
      aria-label="Drawing options"
    >
      <div
        className="drawing-style-options"
        role="radiogroup"
        aria-label="Drawing style"
      >
        {drawingStyles.map((option) => {
          const Icon = drawingIcons[option.id];
          const selected = option.id === style;

          return (
            <button
              key={option.id}
              type="button"
              className="drawing-style-choice"
              role="radio"
              aria-label={option.label}
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              title={option.label}
              onClick={() => onStyleChange(option.id)}
              onKeyDown={moveRadioFocus}
            >
              <Icon aria-hidden="true" strokeWidth={2.7} />
            </button>
          );
        })}
      </div>

      <div
        className="drawing-color-options"
        role="radiogroup"
        aria-label="Drawing color"
        data-grid-columns="3"
      >
        {drawingColors.map((option) => {
          const selected = option.id === color;

          return (
            <button
              key={option.id}
              type="button"
              className={`drawing-color-choice${
                option.id === 'white' ? ' is-white' : ''
              }`}
              role="radio"
              aria-label={option.label}
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              title={option.label}
              style={
                {
                  '--drawing-swatch-color': option.value,
                } as CSSProperties
              }
              onClick={() => onColorChange(option.id)}
              onKeyDown={moveRadioFocus}
            >
              <span aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
