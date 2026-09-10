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
  shortcut?: string;
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
  /** The original, unmodified image source. */
  src: string;
  name: string;
  /** A cached transparent PNG produced by background removal. */
  backgroundRemovedSrc?: string;
  /** Whether the cached background-removed variant is currently visible. */
  backgroundRemoved?: boolean;
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

export type ShapeType =
  | 'circle'
  | 'square'
  | 'rectangle'
  | 'triangle'
  | 'diamond'
  | 'rounded-rectangle'
  | 'half-circle'
  | 'arrow';

export type ArrowDirection = 'left' | 'right';

export type ShapeColor =
  | 'charcoal'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'red'
  | 'white';

export type CanvasShape = CanvasTransform & {
  kind: 'shape';
  shape: ShapeType;
  color: ShapeColor;
  arrowDirection?: ArrowDirection;
  filled?: boolean;
};

export type DrawingStyle = 'pen' | 'marker' | 'highlighter' | 'brush';

export type DrawingColor =
  | 'charcoal'
  | 'cyan'
  | 'green'
  | 'white'
  | 'yellow'
  | 'red';

export type Point = {
  x: number;
  y: number;
};

export type StrokePoint = Point & {
  velocity: number;
};

export type EraserPoint = Point & {
  radius: number;
};

export type EraserTrace = {
  id: string;
  points: EraserPoint[];
};

export type CanvasStroke = {
  kind: 'stroke';
  id: string;
  style: DrawingStyle;
  color: DrawingColor;
  points: StrokePoint[];
  erasures?: EraserTrace[];
};

export type TransformableCanvasItem =
  | CanvasImage
  | CanvasStickyNote
  | CanvasShape;

export type CanvasItem = TransformableCanvasItem | CanvasStroke;

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

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

export type Gesture = {
  kind: 'move' | 'resize' | 'rotate';
  pointerId: number;
  slideId: string;
  itemId: string;
  initialItem: TransformableCanvasItem;
  initialIndex: number;
  broughtToFront: boolean;
  boardRect: BoardRect;
  startPoint: Point;
  startAngle?: number;
  corner?: ResizeCorner;
  moved: boolean;
};
