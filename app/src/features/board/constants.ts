import {
  Brush,
  Circle,
  Eraser,
  MousePointer2,
  Pen,
  ScanText,
} from 'lucide-react';

import type { HistoryState, ResizeCorner, Slide, Tool } from './types';

export const BOARD_WIDTH = 1600;
export const BOARD_HEIGHT = 900;
export const MIN_IMAGE_SIZE = 56;
export const HISTORY_LIMIT = 100;
export const MAX_SLIDES = 20;
export const INITIAL_SLIDE_ID = 'slide-1';

export const tools: Tool[] = [
  { label: 'Pen', icon: Pen, menu: true },
  { label: 'Eraser', icon: Eraser },
  { label: 'Select', icon: MousePointer2 },
  { label: 'Sticky note', icon: null },
  { label: 'Shape', icon: Circle, menu: true },
  { label: 'Text box', icon: ScanText },
  { label: 'Laser pointer', icon: Brush },
];

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
