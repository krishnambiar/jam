import type { LucideIcon } from 'lucide-react';

export type Tool = {
  label: string;
  icon: LucideIcon | null;
  menu?: boolean;
};

export type CanvasImage = {
  id: string;
  src: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type HistoryState = {
  past: CanvasImage[][];
  present: CanvasImage[];
  future: CanvasImage[][];
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
  imageId: string;
  initialImage: CanvasImage;
  boardRect: BoardRect;
  startPoint: Point;
  startAngle?: number;
  corner?: ResizeCorner;
  moved: boolean;
};
