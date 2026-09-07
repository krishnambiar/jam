import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  HISTORY_LIMIT,
  MIN_IMAGE_SIZE,
} from './constants';
import type {
  BoardRect,
  CanvasImage,
  Point,
  ResizeCorner,
  SlideDeck,
} from './types';

export function addToPast(past: CanvasImage[][], snapshot: CanvasImage[]) {
  return [...past, snapshot].slice(-HISTORY_LIMIT);
}

export function addDeckToPast(past: SlideDeck[], snapshot: SlideDeck) {
  return [...past, snapshot].slice(-HISTORY_LIMIT);
}

export function boardPoint(
  clientX: number,
  clientY: number,
  rect: BoardRect,
): Point {
  return {
    x: ((clientX - rect.left) / rect.width) * BOARD_WIDTH,
    y: ((clientY - rect.top) / rect.height) * BOARD_HEIGHT,
  };
}

function rotateVector(point: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);

  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

export function clamp(value: number, minimum: number, maximum: number) {
  if (maximum < minimum) return (minimum + maximum) / 2;
  return Math.min(Math.max(value, minimum), maximum);
}

export function normalizeRotation(degrees: number) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

export function resizedImage(
  image: CanvasImage,
  corner: ResizeCorner,
  pointer: Point,
): CanvasImage {
  const horizontalSign = corner.endsWith('e') ? 1 : -1;
  const verticalSign = corner.startsWith('s') ? 1 : -1;
  const aspectRatio = image.width / image.height;
  const fixedOffset = rotateVector(
    {
      x: (-horizontalSign * image.width) / 2,
      y: (-verticalSign * image.height) / 2,
    },
    image.rotation,
  );
  const fixedCorner = {
    x: image.x + fixedOffset.x,
    y: image.y + fixedOffset.y,
  };
  const pointerFromFixed = rotateVector(
    { x: pointer.x - fixedCorner.x, y: pointer.y - fixedCorner.y },
    -image.rotation,
  );
  const diagonal = {
    x: horizontalSign * aspectRatio,
    y: verticalSign,
  };
  const projectedHeight =
    (pointerFromFixed.x * diagonal.x + pointerFromFixed.y * diagonal.y) /
    (diagonal.x * diagonal.x + diagonal.y * diagonal.y);
  const minimumHeight = Math.max(MIN_IMAGE_SIZE, MIN_IMAGE_SIZE / aspectRatio);
  const nextHeight = clamp(projectedHeight, minimumHeight, BOARD_HEIGHT * 2);
  const nextWidth = nextHeight * aspectRatio;
  const draggedOffset = rotateVector(
    {
      x: horizontalSign * nextWidth,
      y: verticalSign * nextHeight,
    },
    image.rotation,
  );
  const draggedCorner = {
    x: fixedCorner.x + draggedOffset.x,
    y: fixedCorner.y + draggedOffset.y,
  };

  return {
    ...image,
    x: (fixedCorner.x + draggedCorner.x) / 2,
    y: (fixedCorner.y + draggedCorner.y) / 2,
    width: nextWidth,
    height: nextHeight,
  };
}

export function fittedImageSize(naturalWidth: number, naturalHeight: number) {
  const maxWidth = BOARD_WIDTH * 0.42;
  const maxHeight = BOARD_HEIGHT * 0.48;
  let scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);
  const longestSide = Math.max(naturalWidth, naturalHeight) * scale;

  if (longestSide < 120) {
    scale *= 120 / longestSide;
  }

  return {
    width: naturalWidth * scale,
    height: naturalHeight * scale,
  };
}

export function isTextEntry(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function decodeImageFile(file: File) {
  return new Promise<{
    src: string;
    name: string;
    naturalWidth: number;
    naturalHeight: number;
  }>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('The clipboard file could not be read.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('The clipboard file was not an image.'));
        return;
      }

      const image = new Image();
      image.onerror = () => reject(new Error('The image format could not be decoded.'));
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error('The image has no visible dimensions.'));
          return;
        }

        resolve({
          src: reader.result as string,
          name: file.name || 'Pasted image',
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
