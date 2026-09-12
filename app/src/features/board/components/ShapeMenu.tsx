import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { shapeOptions } from '../constants';
import type { ShapeType } from '../types';
import { ShapeContent } from './ShapeContent';

type ShapeMenuProps = {
  focusSelected: boolean;
  shape: ShapeType;
  onShapeFocus: (shape: ShapeType) => void;
  onShapeSelect: (shape: ShapeType) => void;
};

function moveShapeFocus(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  onShapeFocus: (shape: ShapeType) => void,
) {
  const choices = Array.from(
    event.currentTarget
      .closest('[role="radiogroup"]')
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [],
  );
  const currentIndex = choices.indexOf(event.currentTarget);
  let nextIndex = currentIndex;

  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = choices.length - 1;
  else if (event.key === 'ArrowLeft') {
    nextIndex = Math.floor(currentIndex / 4) * 4 + ((currentIndex + 3) % 4);
  } else if (event.key === 'ArrowRight') {
    nextIndex = Math.floor(currentIndex / 4) * 4 + ((currentIndex + 1) % 4);
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    nextIndex = (currentIndex + 4) % choices.length;
  } else {
    return;
  }

  event.preventDefault();
  onShapeFocus(shapeOptions[nextIndex].id);
  choices[nextIndex]?.focus();
}

export function ShapeMenu({
  focusSelected,
  shape,
  onShapeFocus,
  onShapeSelect,
}: ShapeMenuProps) {
  return (
    <div
      id="shape-options"
      className="shape-menu"
      role="radiogroup"
      aria-label="Shape type"
    >
      {shapeOptions.map((option) => {
        const selected = option.id === shape;

        return (
          <button
            key={option.id}
            type="button"
            className="shape-choice"
            role="radio"
            aria-label={option.label}
            aria-checked={selected}
            autoFocus={focusSelected && selected}
            tabIndex={selected ? 0 : -1}
            title={option.label}
            onClick={() => onShapeSelect(option.id)}
            onKeyDown={(event) => moveShapeFocus(event, onShapeFocus)}
          >
            <ShapeContent icon shape={option.id} />
          </button>
        );
      })}
    </div>
  );
}
