import {
  Brush,
  Circle,
  Eraser,
  MousePointer2,
  Pen,
  ScanText,
} from 'lucide-react';

import type {
  DrawingColor,
  DrawingStyle,
  HistoryState,
  ResizeCorner,
  ShapeColor,
  ShapeType,
  Slide,
  StickyNoteColor,
  TextBoxStyle,
  Tool,
} from './types';

export const BOARD_WIDTH = 1600;
export const BOARD_HEIGHT = 900;
export const MIN_ITEM_SIZE = 56;
export const MIN_SHAPE_DRAW_SIZE = 8;
export const STICKY_NOTE_SIZE = 280;
export const TEXT_BOX_DEFAULT_WIDTH = 420;
export const TEXT_BOX_MIN_WIDTH = 120;
export const TEXT_BOX_MIN_HEIGHT = 42;
export const HISTORY_LIMIT = 100;
export const MAX_SLIDES = 20;
export const INITIAL_SLIDE_ID = 'slide-1';

export const tools: Tool[] = [
  { id: 'pen', label: 'Pen', icon: Pen, menu: true, shortcut: 'P' },
  { id: 'eraser', label: 'Ink eraser', icon: Eraser, shortcut: 'E' },
  { id: 'select', label: 'Select', icon: MousePointer2 },
  { id: 'sticky-note', label: 'Sticky note', icon: null },
  { id: 'shape', label: 'Shape', icon: Circle, menu: true },
  { id: 'text-box', label: 'Text box', icon: ScanText },
  { id: 'laser-pointer', label: 'Laser pointer', icon: Brush },
];

export const drawingStyles: ReadonlyArray<{
  id: DrawingStyle;
  label: string;
  strokeWidth: number;
  opacity: number;
}> = [
  { id: 'pen', label: 'Pen', strokeWidth: 4, opacity: 1 },
  { id: 'marker', label: 'Marker', strokeWidth: 9, opacity: 1 },
  { id: 'highlighter', label: 'Highlighter', strokeWidth: 23, opacity: 0.5 },
  { id: 'brush', label: 'Brush', strokeWidth: 28, opacity: 0.18 },
];

export const drawingColors: ReadonlyArray<{
  id: DrawingColor;
  label: string;
  value: string;
}> = [
  { id: 'charcoal', label: 'Black', value: '#444949' },
  { id: 'cyan', label: 'Blue', value: '#51b5c6' },
  { id: 'green', label: 'Green', value: '#74a94a' },
  { id: 'white', label: 'White', value: '#ffffff' },
  { id: 'yellow', label: 'Yellow', value: '#f4bc2e' },
  { id: 'red', label: 'Red', value: '#dd4f44' },
];

export function getDrawingStylePreset(style: DrawingStyle) {
  return drawingStyles.find((option) => option.id === style) ?? drawingStyles[0];
}

export function getDrawingColorValue(color: DrawingColor) {
  return (
    drawingColors.find((option) => option.id === color)?.value ??
    drawingColors[0].value
  );
}

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

export const shapeOptions: ReadonlyArray<{
  id: ShapeType;
  label: string;
}> = [
  { id: 'circle', label: 'Circle' },
  { id: 'square', label: 'Square' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'rounded-rectangle', label: 'Rounded rectangle' },
  { id: 'half-circle', label: 'Half-circle' },
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'arrow', label: 'Arrow' },
];

export const shapeColors: ReadonlyArray<{
  id: ShapeColor;
  label: string;
  stroke: string;
  fill: string;
}> = [
  {
    id: 'charcoal',
    label: 'Black',
    stroke: getDrawingColorValue('charcoal'),
    fill: '#e9eaea',
  },
  {
    id: 'blue',
    label: 'Blue',
    stroke: getDrawingColorValue('cyan'),
    fill: '#e5f5f7',
  },
  {
    id: 'green',
    label: 'Green',
    stroke: getDrawingColorValue('green'),
    fill: '#edf4e8',
  },
  {
    id: 'white',
    label: 'White',
    stroke: getDrawingColorValue('white'),
    fill: '#ffffff',
  },
  {
    id: 'yellow',
    label: 'Yellow',
    stroke: getDrawingColorValue('yellow'),
    fill: '#fdf5df',
  },
  {
    id: 'red',
    label: 'Red',
    stroke: getDrawingColorValue('red'),
    fill: '#f9e9e7',
  },
];

export function getShapeOption(shape: ShapeType) {
  return shapeOptions.find((option) => option.id === shape) ?? shapeOptions[0];
}

export function getShapeColorValue(color: ShapeColor) {
  return shapeColors.find((option) => option.id === color) ?? shapeColors[0];
}

export const textBoxStyles: ReadonlyArray<{
  id: TextBoxStyle;
  label: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
}> = [
  {
    id: 'display',
    label: 'Display',
    fontSize: 52,
    fontWeight: 500,
    lineHeight: 1.12,
  },
  {
    id: 'normal',
    label: 'Normal',
    fontSize: 30,
    fontWeight: 400,
    lineHeight: 1.28,
  },
  {
    id: 'caption',
    label: 'Caption',
    fontSize: 20,
    fontWeight: 400,
    lineHeight: 1.35,
  },
];

export const textBoxColors = drawingColors;

export function getTextBoxStyle(style: TextBoxStyle) {
  return textBoxStyles.find((option) => option.id === style) ?? textBoxStyles[1];
}

export const getTextBoxColorValue = getDrawingColorValue;

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
