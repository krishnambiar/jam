import {
  Brush,
  Circle,
  Eraser,
  MousePointer2,
  Pen,
  ScanText,
} from 'lucide-react';

import type {
  HistoryState,
  ResizeCorner,
  Slide,
  StickyNoteColor,
  Tool,
} from './types';

export const BOARD_WIDTH = 1600;
export const BOARD_HEIGHT = 900;
export const MIN_ITEM_SIZE = 56;
export const STICKY_NOTE_SIZE = 280;
export const HISTORY_LIMIT = 100;
export const MAX_SLIDES = 20;
export const INITIAL_SLIDE_ID = 'slide-1';

export const tools: Tool[] = [
  { id: 'pen', label: 'Pen', icon: Pen, menu: true },
  { id: 'eraser', label: 'Eraser', icon: Eraser },
  { id: 'select', label: 'Select', icon: MousePointer2 },
  { id: 'sticky-note', label: 'Sticky note', icon: null },
  { id: 'shape', label: 'Shape', icon: Circle, menu: true },
  { id: 'text-box', label: 'Text box', icon: ScanText },
  { id: 'laser-pointer', label: 'Laser pointer', icon: Brush },
];

export const stickyNoteColors: ReadonlyArray<{
  id: StickyNoteColor;
  label: string;
  value: string;
}> = [
  { id: 'yellow', label: 'Yellow', value: '#fff100' },
  { id: 'green', label: 'Green', value: '#99f400' },
  { id: 'blue', label: 'Blue', value: '#62e1ee' },
  { id: 'pink', label: 'Pink', value: '#ff71a9' },
  { id: 'orange', label: 'Orange', value: '#ff9d00' },
  { id: 'transparent', label: 'No fill', value: 'transparent' },
];

export function getStickyNoteColorValue(color: StickyNoteColor) {
  return (
    stickyNoteColors.find((option) => option.id === color)?.value ??
    stickyNoteColors[0].value
  );
}

export const resizeCorners: ResizeCorner[] = ['nw', 'ne', 'sw', 'se'];

export const EMPTY_HISTORY: HistoryState = {
  past: [],
  present: [],
  future: [],
};

export function createEmptySlide(id: string): Slide {
  return {
    id,
    history: {
      past: [],
      present: [],
      future: [],
    },
  };
}
