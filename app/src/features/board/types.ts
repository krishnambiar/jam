import type { LucideIcon } from 'lucide-react';

export type Tool = {
  id:
    | 'pen'
    | 'eraser'
    | 'select'
    | 'sticky-note'
    | 'shape'
    | 'text-box'
    | 'laser-pointer';
  label: string;
  icon: LucideIcon | null;
  menu?: boolean;
};

export type CanvasTransform = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type CanvasImage = CanvasTransform & {
  kind: 'image';
  src: string;
  name: string;
};

export type StickyNoteColor =
  | 'yellow'
  | 'green'
  | 'blue'
  | 'pink'
  | 'orange'
  | 'transparent';

export type CanvasStickyNote = CanvasTransform & {
  kind: 'sticky-note';
  text: string;
  color: StickyNoteColor;
};

export type CanvasItem = CanvasImage | CanvasStickyNote;

export type HistoryState = {
  past: CanvasItem[][];
  present: CanvasItem[];
  future: CanvasItem[][];
};

export type Slide = {
  id: string;
  history: HistoryState;
};

export type SlideDeck = {
  slides: Slide[];
  activeSlideId: string;
};

export type DeckHistoryState = {
  past: SlideDeck[];
  present: SlideDeck;
  future: SlideDeck[];
};

export type BoardRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type Point = {
  x: number;
  y: number;
};

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

export type Gesture = {
  kind: 'move' | 'resize' | 'rotate';
  pointerId: number;
  slideId: string;
  itemId: string;
  initialItem: CanvasItem;
  initialIndex: number;
  broughtToFront: boolean;
  boardRect: BoardRect;
  startPoint: Point;
  startAngle?: number;
  corner?: ResizeCorner;
  moved: boolean;
};
