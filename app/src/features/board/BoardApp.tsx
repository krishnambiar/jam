import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  CopyPlus,
  ImageOff,
  MoreVertical,
  PaintBucket,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
  UserRound,
  ZoomIn,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { DrawingMenu } from './components/DrawingMenu';
import {
  InkStrokePath,
  type InkStrokeHandle,
} from './components/InkStroke';
import { SlidePreview } from './components/SlidePreview';
import { ShapeContent } from './components/ShapeContent';
import { ShapeMenu } from './components/ShapeMenu';
import { StickyNoteContent } from './components/StickyNoteContent';
import { ToolButton } from './components/ToolButton';
import {
  BACKGROUND_REMOVAL_ENABLED,
  BackgroundRemovalError,
  activeImageSource,
  getBackgroundRemovalErrorMessage,
  removeImageBackground,
} from './backgroundRemoval';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  INITIAL_SLIDE_ID,
  MAX_SLIDES,
  MIN_SHAPE_DRAW_SIZE,
  STICKY_NOTE_SIZE,
  createEmptySlide,
  getStickyNoteColorValue,
  getShapeColorValue,
  getShapeOption,
  resizeCorners,
  shapeColors,
  stickyNoteColors,
  tools,
} from './constants';
import type {
  BoardRect,
  CanvasImage,
  CanvasItem,
  CanvasShape,
  CanvasStickyNote,
  CanvasStroke,
  DeckHistoryState,
  DrawingColor,
  DrawingStyle,
  EraserPoint,
  EraserTrace,
  Gesture,
  HistoryState,
  Point,
  ResizeCorner,
  ShapeColor,
  ShapeType,
  SlideDeck,
  StrokePoint,
  StickyNoteColor,
  Tool,
  TransformableCanvasItem,
} from './types';
import {
  addDeckToPast,
  addToPast,
  applyEraserTraceToItems,
  appendStrokePoints,
  boardPoint,
  clamp,
  decodeImageFile,
  eraserRadiusForVelocity,
  fittedImageSize,
  getInkRuns,
  isTextEntry,
  normalizeRotation,
  resizedItem,
  rotatedItemExtents,
  type EraserSweep,
} from './utils';

type StickyNoteEdit = {
  itemId: string;
  slideId: string;
  draft: string;
  isNew: boolean;
};

type PendingStickyNote = {
  note: CanvasStickyNote;
  slideId: string;
  discarding: boolean;
};

type InkGesture = {
  pointerId: number;
  slideId: string;
  boardRect: BoardRect;
  stroke: CanvasStroke;
  lastSample: Point & { time: number };
  velocity: number | null;
};

type EraserGesture = {
  pointerId: number;
  slideId: string;
  boardRect: BoardRect;
  initialItems: CanvasItem[];
  workingItems: CanvasItem[];
  trace: EraserTrace;
  sweeps: EraserSweep[];
  lastSample: EraserPoint & { time: number };
  velocity: number | null;
};

type PendingErase = {
  slideId: string;
  items: CanvasItem[];
};

type ShapeGesture = {
  pointerId: number;
  slideId: string;
  boardRect: BoardRect;
  startPoint: Point;
  shape: CanvasShape;
};

type PendingShape = {
  slideId: string;
  shape: CanvasShape;
};

type BackgroundRemovalJob = {
  key: string;
  slideId: string;
  itemId: string;
  originalSrc: string;
  requestToken: string;
  controller: AbortController;
  processedSrc?: string;
};

const ITEM_CLIPBOARD_TYPE = 'application/x-untitled-jam-item';
const MAX_CUSTOM_CLIPBOARD_SOURCE_CHARACTERS = 8 * 1024 * 1024;

function backgroundRemovalJobKey(slideId: string, itemId: string) {
  return JSON.stringify([slideId, itemId]);
}

function clipboardLabel(item: TransformableCanvasItem) {
  if (item.kind === 'shape') {
    return `Untitled Jam ${getShapeOption(item.shape).label} shape`;
  }
  if (item.kind === 'sticky-note') return 'Untitled Jam sticky note';
  return `Untitled Jam image: ${item.name}`;
}

function isClipboardItem(value: unknown): value is TransformableCanvasItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const hasTransform =
    typeof item.id === 'string' &&
    typeof item.x === 'number' &&
    typeof item.y === 'number' &&
    typeof item.width === 'number' &&
    typeof item.height === 'number' &&
    typeof item.rotation === 'number';
  if (!hasTransform) return false;

  if (item.kind === 'shape') {
    return (
      shapeColors.some((color) => color.id === item.color) &&
      getShapeOption(item.shape as ShapeType).id === item.shape &&
      (item.arrowDirection === undefined ||
        item.arrowDirection === 'left' ||
        item.arrowDirection === 'right') &&
      (item.filled === undefined || typeof item.filled === 'boolean')
    );
  }
  if (item.kind === 'sticky-note') {
    return (
      typeof item.text === 'string' &&
      stickyNoteColors.some((color) => color.id === item.color)
    );
  }
  return (
    item.kind === 'image' &&
    typeof item.src === 'string' &&
    typeof item.name === 'string' &&
    (item.backgroundRemovedSrc === undefined ||
      typeof item.backgroundRemovedSrc === 'string') &&
    (item.backgroundRemoved === undefined ||
      typeof item.backgroundRemoved === 'boolean') &&
    (item.backgroundRemoved !== true ||
      (typeof item.backgroundRemovedSrc === 'string' &&
        item.backgroundRemovedSrc.length > 0))
  );
}

function moveColorChoiceFocus(event: ReactKeyboardEvent<HTMLButtonElement>) {
  const direction =
    event.key === 'ArrowLeft' || event.key === 'ArrowUp'
      ? -1
      : event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : 0;
  const group = event.currentTarget.closest('[role="radiogroup"]');
  const choices = Array.from(
    group?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [],
  );
  let nextIndex = choices.indexOf(event.currentTarget);

  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = choices.length - 1;
  else if (direction !== 0 && choices.length > 0) {
    nextIndex = (nextIndex + direction + choices.length) % choices.length;
  } else {
    return;
  }

  event.preventDefault();
  choices[nextIndex]?.focus();
}

function itemMenuChoices(menu: HTMLElement) {
  return Array.from(
    menu.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ),
  );
}

function setItemMenuTabStop(menu: HTMLElement, choice: HTMLButtonElement) {
  itemMenuChoices(menu).forEach((candidate) => {
    candidate.tabIndex = candidate === choice ? 0 : -1;
  });
}

function moveItemMenuFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
  const direction =
    event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
  const choices = itemMenuChoices(event.currentTarget);
  let nextIndex = choices.findIndex((choice) => choice === document.activeElement);

  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = choices.length - 1;
  else if (direction !== 0 && choices.length > 0) {
    const startIndex =
      nextIndex < 0 ? (direction > 0 ? -1 : 0) : nextIndex;
    nextIndex = (startIndex + direction + choices.length) % choices.length;
  } else {
    return;
  }

  event.preventDefault();
  const choice = choices[nextIndex];
  if (!choice) return;
  setItemMenuTabStop(event.currentTarget, choice);
  choice.focus();
}

function bringItemToFront(items: CanvasItem[], itemId: string) {
  const itemIndex = items.findIndex((item) => item.id === itemId);
  if (itemIndex < 0 || itemIndex === items.length - 1) return items;

  return [
    ...items.slice(0, itemIndex),
    ...items.slice(itemIndex + 1),
    items[itemIndex],
  ];
}

function restoreGestureStart(items: CanvasItem[], gesture: Gesture) {
  const itemIndex = items.findIndex((item) => item.id === gesture.itemId);
  if (itemIndex < 0) return items;

  const withoutItem = [
    ...items.slice(0, itemIndex),
    ...items.slice(itemIndex + 1),
  ];
  const restoredIndex = Math.min(gesture.initialIndex, withoutItem.length);

  return [
    ...withoutItem.slice(0, restoredIndex),
    gesture.initialItem,
    ...withoutItem.slice(restoredIndex),
  ];
}

function eraserRadiusInBoardUnits(
  boardRect: BoardRect,
  velocity: number,
) {
  const horizontalScale = boardRect.width / BOARD_WIDTH;
  const verticalScale = boardRect.height / BOARD_HEIGHT;
  const screenScale = Math.max(
    0.001,
    (horizontalScale + verticalScale) / 2,
  );
  return eraserRadiusForVelocity(velocity) / screenScale;
}

function copiedItemPosition(
  source: TransformableCanvasItem,
  items: CanvasItem[],
) {
  const extents = rotatedItemExtents(source);
  const directions = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  for (let step = 1; step <= 8; step += 1) {
    for (const [horizontal, vertical] of directions) {
      const x = clamp(
        source.x + horizontal * step * 32,
        extents.horizontal,
        BOARD_WIDTH - extents.horizontal,
      );
      const y = clamp(
        source.y + vertical * step * 32,
        extents.vertical,
        BOARD_HEIGHT - extents.vertical,
      );
      if (Math.abs(x - source.x) < 0.5 && Math.abs(y - source.y) < 0.5) {
        continue;
      }

      const occupied = items.some(
        (item) =>
          item.kind !== 'stroke' &&
          Math.abs(item.x - x) < 0.5 &&
          Math.abs(item.y - y) < 0.5,
      );
      if (!occupied) return { x, y };
    }
  }

  return { x: source.x, y: source.y };
}

export default function BoardApp() {
  const [selectedToolId, setSelectedToolId] = useState<Tool['id']>('select');
  const [drawingStyle, setDrawingStyle] = useState<DrawingStyle>('pen');
  const [drawingColor, setDrawingColor] = useState<DrawingColor>('charcoal');
  const [isDrawingMenuOpen, setIsDrawingMenuOpen] = useState(false);
  const [activeShape, setActiveShape] = useState<ShapeType>('circle');
  const [activeShapeColor, setActiveShapeColor] =
    useState<ShapeColor>('charcoal');
  const [isShapeMenuOpen, setIsShapeMenuOpen] = useState(false);
  const [focusShapeMenuSelection, setFocusShapeMenuSelection] = useState(false);
  const [pendingStroke, setPendingStroke] = useState<CanvasStroke | null>(null);
  const [pendingShape, setPendingShape] = useState<PendingShape | null>(null);
  const [pendingErase, setPendingErase] = useState<PendingErase | null>(null);
  const [eraserPreview, setEraserPreview] = useState<EraserPoint | null>(null);
  const [deckHistory, setDeckHistory] = useState<DeckHistoryState>(() => ({
    past: [],
    present: {
      slides: [createEmptySlide(INITIAL_SLIDE_ID)],
      activeSlideId: INITIAL_SLIDE_ID,
    },
    future: [],
  }));
  const deck = deckHistory.present;
  const [isSlideOverviewOpen, setIsSlideOverviewOpen] = useState(false);
  const [overviewScrollAvailability, setOverviewScrollAvailability] = useState({
    left: false,
    right: false,
  });
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [openItemMenuId, setOpenItemMenuId] = useState<string | null>(null);
  const [openColorPickerId, setOpenColorPickerId] = useState<string | null>(null);
  const [stickyNoteEdit, setStickyNoteEdit] = useState<StickyNoteEdit | null>(
    null,
  );
  const [pendingStickyNote, setPendingStickyNote] =
    useState<PendingStickyNote | null>(null);
  const [openSlideMenuId, setOpenSlideMenuId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [backgroundRemovalJobKeys, setBackgroundRemovalJobKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const boardRef = useRef<HTMLDivElement>(null);
  const overviewViewportRef = useRef<HTMLDivElement>(null);
  const activeThumbnailRef = useRef<HTMLButtonElement>(null);
  const slideMenuButtonRef = useRef<HTMLButtonElement>(null);
  const frameCounterRef = useRef<HTMLButtonElement>(null);
  const penToolButtonRef = useRef<HTMLButtonElement>(null);
  const shapeToolButtonRef = useRef<HTMLButtonElement>(null);
  const drawingSurfaceRef = useRef<HTMLDivElement>(null);
  const activeInkRendererRef = useRef<InkStrokeHandle>(null);
  const inkRenderFrameRef = useRef<number | null>(null);
  const activeColorChoiceRef = useRef<HTMLButtonElement>(null);
  const focusColorPickerOnOpenRef = useRef(false);
  const focusItemMenuOnOpenRef = useRef(false);
  const finishingStickyNoteIdRef = useRef<string | null>(null);
  const stickyNoteDiscardTimersRef = useRef<number[]>([]);
  const gestureRef = useRef<Gesture | null>(null);
  const backgroundRemovalJobsRef = useRef<Map<string, BackgroundRemovalJob>>(
    new Map(),
  );
  const itemFrameRefsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const itemMenuButtonRefsRef = useRef<Map<string, HTMLButtonElement>>(
    new Map(),
  );
  const inkGestureRef = useRef<InkGesture | null>(null);
  const eraserGestureRef = useRef<EraserGesture | null>(null);
  const shapeGestureRef = useRef<ShapeGesture | null>(null);
  const copiedItemRef = useRef<TransformableCanvasItem | null>(null);
  const copiedItemLabelRef = useRef<string | null>(null);
  const copiedItemInternalOnlyRef = useRef(false);
  const copyEventHandledRef = useRef(false);
  const activeSlideIdRef = useRef(deck.activeSlideId);
  const deckRef = useRef(deck);
  const wasSlideOverviewOpenRef = useRef(false);
  const overviewReturnFocusRef = useRef<'counter' | 'canvas'>('counter');

  const closeDrawingMenu = useCallback((restoreFocus = false) => {
    setIsDrawingMenuOpen(false);
    if (!restoreFocus) return;

    window.requestAnimationFrame(() => {
      penToolButtonRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const closeShapeMenu = useCallback((restoreFocus = false) => {
    setIsShapeMenuOpen(false);
    if (!restoreFocus) return;

    window.requestAnimationFrame(() => {
      shapeToolButtonRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const cancelActiveInk = useCallback(() => {
    const gesture = inkGestureRef.current;
    inkGestureRef.current = null;
    setPendingStroke(null);
    if (inkRenderFrameRef.current !== null) {
      window.cancelAnimationFrame(inkRenderFrameRef.current);
      inkRenderFrameRef.current = null;
    }

    if (
      gesture &&
      drawingSurfaceRef.current?.hasPointerCapture(gesture.pointerId)
    ) {
      drawingSurfaceRef.current.releasePointerCapture(gesture.pointerId);
    }
  }, []);

  const cancelActiveEraser = useCallback(() => {
    const gesture = eraserGestureRef.current;
    eraserGestureRef.current = null;
    setPendingErase(null);
    setEraserPreview(null);

    if (
      gesture &&
      drawingSurfaceRef.current?.hasPointerCapture(gesture.pointerId)
    ) {
      drawingSurfaceRef.current.releasePointerCapture(gesture.pointerId);
    }
  }, []);

  const cancelActiveShape = useCallback(() => {
    const gesture = shapeGestureRef.current;
    shapeGestureRef.current = null;
    setPendingShape(null);

    if (
      gesture &&
      drawingSurfaceRef.current?.hasPointerCapture(gesture.pointerId)
    ) {
      drawingSurfaceRef.current.releasePointerCapture(gesture.pointerId);
    }
  }, []);

  const cancelActiveMarking = useCallback(() => {
    cancelActiveInk();
    cancelActiveEraser();
    cancelActiveShape();
  }, [cancelActiveEraser, cancelActiveInk, cancelActiveShape]);

  const closeSlideMenu = useCallback((restoreFocus = false) => {
    setOpenSlideMenuId(null);
    if (!restoreFocus) return;

    window.requestAnimationFrame(() => {
      slideMenuButtonRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const closeSlideOverview = useCallback(
    (returnFocus: 'counter' | 'canvas' = 'counter') => {
      overviewReturnFocusRef.current = returnFocus;
      closeSlideMenu();
      setIsSlideOverviewOpen(false);
    },
    [closeSlideMenu],
  );

  const setDeck = useCallback((update: (deck: SlideDeck) => SlideDeck) => {
    setDeckHistory((current) => {
      const present = update(current.present);
      return present === current.present ? current : { ...current, present };
    });
  }, []);

  useLayoutEffect(() => {
    activeSlideIdRef.current = deck.activeSlideId;
    deckRef.current = deck;
  }, [deck]);

  const activeSlideIndex = Math.max(
    0,
    deck.slides.findIndex((slide) => slide.id === deck.activeSlideId),
  );
  const activeSlide = deck.slides[activeSlideIndex];
  const history = activeSlide?.history ?? EMPTY_HISTORY;

  const focusItemFrame = useCallback((itemId: string) => {
    window.requestAnimationFrame(() => {
      itemFrameRefsRef.current.get(itemId)?.focus({ preventScroll: true });
    });
  }, []);

  const removeTrackedBackgroundRemovalJob = useCallback(
    (job: BackgroundRemovalJob, abort = false) => {
      if (backgroundRemovalJobsRef.current.get(job.key) !== job) return false;
      if (abort) job.controller.abort();
      backgroundRemovalJobsRef.current.delete(job.key);
      setBackgroundRemovalJobKeys((current) => {
        if (!current.has(job.key)) return current;
        const next = new Set(current);
        next.delete(job.key);
        return next;
      });
      return true;
    },
    [],
  );

  const cancelBackgroundRemovalJob = useCallback(
    (slideId: string, itemId: string) => {
      const job = backgroundRemovalJobsRef.current.get(
        backgroundRemovalJobKey(slideId, itemId),
      );
      if (job) removeTrackedBackgroundRemovalJob(job, true);
    },
    [removeTrackedBackgroundRemovalJob],
  );

  const cancelBackgroundRemovalJobsForSlide = useCallback(
    (slideId: string) => {
      Array.from(backgroundRemovalJobsRef.current.values()).forEach((job) => {
        if (job.slideId === slideId) {
          removeTrackedBackgroundRemovalJob(job, true);
        }
      });
    },
    [removeTrackedBackgroundRemovalJob],
  );

  const cancelAllBackgroundRemovalJobs = useCallback(() => {
    Array.from(backgroundRemovalJobsRef.current.values()).forEach((job) => {
      removeTrackedBackgroundRemovalJob(job, true);
    });
  }, [removeTrackedBackgroundRemovalJob]);

  const applyCompletedBackgroundRemoval = useCallback(
    (job: BackgroundRemovalJob) => {
      if (!job.processedSrc) return;
      if (backgroundRemovalJobsRef.current.get(job.key) !== job) return;

      const targetSlide = deckRef.current.slides.find(
        (slide) => slide.id === job.slideId,
      );
      const targetImage = targetSlide?.history.present.find(
        (item): item is CanvasImage =>
          item.id === job.itemId && item.kind === 'image',
      );
      if (!targetImage || targetImage.src !== job.originalSrc) {
        removeTrackedBackgroundRemovalJob(job, true);
        return;
      }

      const processedSrc = job.processedSrc;
      const slideNumber =
        deckRef.current.slides.findIndex((slide) => slide.id === job.slideId) +
        1;
      removeTrackedBackgroundRemovalJob(job);
      setDeckHistory((current) => {
        const slideIndex = current.present.slides.findIndex(
          (slide) => slide.id === job.slideId,
        );
        if (slideIndex < 0) return current;

        const slide = current.present.slides[slideIndex];
        const imageIndex = slide.history.present.findIndex(
          (item) =>
            item.id === job.itemId &&
            item.kind === 'image' &&
            item.src === job.originalSrc,
        );
        if (imageIndex < 0) return current;

        const image = slide.history.present[imageIndex] as CanvasImage;
        const present = [...slide.history.present];
        present[imageIndex] = {
          ...image,
          backgroundRemovedSrc: processedSrc,
          backgroundRemoved: true,
        };
        const slides = [...current.present.slides];
        slides[slideIndex] = {
          ...slide,
          history: {
            past: addToPast(slide.history.past, slide.history.present),
            present,
            future: [],
          },
        };

        return {
          past: addDeckToPast(current.past, current.present),
          present: { ...current.present, slides },
          future: [],
        };
      });
      setNotice(
        activeSlideIdRef.current === job.slideId || slideNumber < 1
          ? 'Background removed.'
          : `Background removed on slide ${slideNumber}.`,
      );
    },
    [removeTrackedBackgroundRemovalJob],
  );

  const flushCompletedBackgroundRemovals = useCallback(() => {
    if (gestureRef.current || eraserGestureRef.current) return;
    Array.from(backgroundRemovalJobsRef.current.values()).forEach((job) => {
      if (job.processedSrc) applyCompletedBackgroundRemoval(job);
    });
  }, [applyCompletedBackgroundRemoval]);

  useEffect(() => {
    if (!pendingErase) flushCompletedBackgroundRemovals();
  }, [flushCompletedBackgroundRemovals, pendingErase]);

  const updateActiveHistory = useCallback(
    (update: (history: HistoryState) => HistoryState) => {
      setDeckHistory((current) => {
        let changed = false;
        const slides = current.present.slides.map((slide) => {
          if (slide.id !== current.present.activeSlideId) return slide;
          const nextHistory = update(slide.history);
          if (nextHistory === slide.history) return slide;
          changed = true;
          return { ...slide, history: nextHistory };
        });

        if (!changed) return current;

        return {
          past: addDeckToPast(current.past, current.present),
          present: { ...current.present, slides },
          future: [],
        };
      });
    },
    [],
  );

  const cancelActiveGesture = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || (!gesture.moved && !gesture.broughtToFront)) {
      flushCompletedBackgroundRemovals();
      return;
    }

    setDeck((current) => ({
      ...current,
      slides: current.slides.map((slide) =>
        slide.id === gesture.slideId
          ? {
              ...slide,
              history: {
                ...slide.history,
                present: restoreGestureStart(
                  slide.history.present,
                  gesture,
                ),
              },
            }
          : slide,
      ),
    }));
    flushCompletedBackgroundRemovals();
  }, [flushCompletedBackgroundRemovals, setDeck]);

  const commit = useCallback(
    (update: (items: CanvasItem[]) => CanvasItem[]) => {
      cancelActiveGesture();
      updateActiveHistory((current) => {
        const next = update(current.present);
        if (next === current.present) return current;

        return {
          past: addToPast(current.past, current.present),
          present: next,
          future: [],
        };
      });
    },
    [cancelActiveGesture, updateActiveHistory],
  );

  const undo = useCallback(() => {
    if (deckHistory.past.length === 0) return;

    cancelActiveMarking();
    closeDrawingMenu();
    closeShapeMenu();
    cancelAllBackgroundRemovalJobs();
    cancelActiveGesture();
    setOpenItemMenuId(null);
    setOpenColorPickerId(null);
    setStickyNoteEdit(null);
    setPendingStickyNote(null);
    closeSlideMenu(openSlideMenuId !== null);
    setSelectedItemId(null);
    setDeckHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;

      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future].slice(0, HISTORY_LIMIT),
      };
    });
  }, [
    cancelActiveGesture,
    cancelActiveMarking,
    cancelAllBackgroundRemovalJobs,
    closeDrawingMenu,
    closeShapeMenu,
    closeSlideMenu,
    deckHistory.past.length,
    openSlideMenuId,
  ]);

  const redo = useCallback(() => {
    if (deckHistory.future.length === 0) return;

    cancelActiveMarking();
    closeDrawingMenu();
    closeShapeMenu();
    cancelAllBackgroundRemovalJobs();
    cancelActiveGesture();
    setOpenItemMenuId(null);
    setOpenColorPickerId(null);
    setStickyNoteEdit(null);
    setPendingStickyNote(null);
    closeSlideMenu(openSlideMenuId !== null);
    setSelectedItemId(null);
    setDeckHistory((current) => {
      const next = current.future[0];
      if (!next) return current;

      return {
        past: addDeckToPast(current.past, current.present),
        present: next,
        future: current.future.slice(1),
      };
    });
  }, [
    cancelActiveGesture,
    cancelActiveMarking,
    cancelAllBackgroundRemovalJobs,
    closeDrawingMenu,
    closeShapeMenu,
    closeSlideMenu,
    deckHistory.future.length,
    openSlideMenuId,
  ]);

  const deleteSlide = useCallback(
    (slideId: string) => {
      const currentDeck = deckRef.current;
      if (
        currentDeck.slides.length <= 1 ||
        !currentDeck.slides.some((slide) => slide.id === slideId)
      ) {
        return;
      }

      cancelActiveMarking();
      closeDrawingMenu();
      closeShapeMenu();
      cancelBackgroundRemovalJobsForSlide(slideId);
      cancelActiveGesture();
      setSelectedItemId(null);
      setOpenItemMenuId(null);
      setOpenColorPickerId(null);
      setStickyNoteEdit(null);
      setPendingStickyNote(null);
      closeSlideMenu();
      setDeckHistory((current) => {
        if (current.present.slides.length <= 1) return current;

        const deletedIndex = current.present.slides.findIndex(
          (slide) => slide.id === slideId,
        );
        if (deletedIndex < 0) return current;

        const slides = current.present.slides.filter(
          (slide) => slide.id !== slideId,
        );
        const activeSlideId =
          current.present.activeSlideId === slideId
            ? slides[Math.min(deletedIndex, slides.length - 1)].id
            : current.present.activeSlideId;

        return {
          past: addDeckToPast(current.past, current.present),
          present: { slides, activeSlideId },
          future: [],
        };
      });
    },
    [
      cancelActiveGesture,
      cancelActiveMarking,
      cancelBackgroundRemovalJobsForSlide,
      closeDrawingMenu,
      closeShapeMenu,
      closeSlideMenu,
    ],
  );

  const navigateToAdjacentSlide = useCallback(
    (direction: -1 | 1) => {
      cancelActiveMarking();
      closeDrawingMenu();
      closeShapeMenu();
      cancelActiveGesture();
      setSelectedItemId(null);
      setOpenItemMenuId(null);
      setOpenColorPickerId(null);
      setStickyNoteEdit(null);
      setPendingStickyNote(null);
      closeSlideMenu();
      setDeck((current) => {
        const currentIndex = current.slides.findIndex(
          (slide) => slide.id === current.activeSlideId,
        );
        const adjacentSlide = current.slides[currentIndex + direction];
        return adjacentSlide
          ? { ...current, activeSlideId: adjacentSlide.id }
          : current;
      });
    },
    [
      cancelActiveGesture,
      cancelActiveMarking,
      closeDrawingMenu,
      closeShapeMenu,
      closeSlideMenu,
      setDeck,
    ],
  );

  const deleteItem = useCallback(
    (itemId: string) => {
      cancelBackgroundRemovalJob(activeSlideIdRef.current, itemId);
      commit((items) => {
        if (!items.some((item) => item.id === itemId)) return items;
        return items.filter((item) => item.id !== itemId);
      });
      setSelectedItemId((current) => (current === itemId ? null : current));
      setOpenItemMenuId(null);
      setOpenColorPickerId(null);
      setStickyNoteEdit((current) =>
        current?.itemId === itemId ? null : current,
      );
      setPendingStickyNote((current) =>
        current?.note.id === itemId ? null : current,
      );
    },
    [cancelBackgroundRemovalJob, commit],
  );

  const rotateItem = useCallback(
    (itemId: string, degrees: number) => {
      commit((items) =>
        items.map((item) =>
          item.id === itemId && item.kind !== 'stroke'
            ? { ...item, rotation: normalizeRotation(item.rotation + degrees) }
            : item,
        ),
      );
      setOpenItemMenuId(null);
    },
    [commit],
  );

  const toggleShapeFill = useCallback(
    (itemId: string) => {
      commit((items) =>
        items.map((item) =>
          item.id === itemId && item.kind === 'shape'
            ? { ...item, filled: !(item.filled ?? true) }
            : item,
        ),
      );
      setOpenItemMenuId(null);
    },
    [commit],
  );

  const toggleImageBackground = useCallback(
    (item: CanvasImage) => {
      const slideId = activeSlideIdRef.current;
      const jobKey = backgroundRemovalJobKey(slideId, item.id);
      setOpenItemMenuId(null);
      focusItemFrame(item.id);

      if (item.backgroundRemoved === true && item.backgroundRemovedSrc) {
        commit((items) =>
          items.map((candidate) =>
            candidate.id === item.id && candidate.kind === 'image'
              ? { ...candidate, backgroundRemoved: false }
              : candidate,
          ),
        );
        setNotice('Background restored.');
        return;
      }

      if (item.backgroundRemovedSrc) {
        commit((items) =>
          items.map((candidate) =>
            candidate.id === item.id && candidate.kind === 'image'
              ? { ...candidate, backgroundRemoved: true }
              : candidate,
          ),
        );
        setNotice('Background removed.');
        return;
      }

      if (backgroundRemovalJobsRef.current.has(jobKey)) return;

      const job: BackgroundRemovalJob = {
        key: jobKey,
        slideId,
        itemId: item.id,
        originalSrc: item.src,
        requestToken: crypto.randomUUID(),
        controller: new AbortController(),
      };
      backgroundRemovalJobsRef.current.set(jobKey, job);
      setBackgroundRemovalJobKeys((current) => new Set(current).add(jobKey));
      setNotice('Removing background…');

      void removeImageBackground(item.src, job.controller.signal).then(
        (processedSrc) => {
          const currentJob = backgroundRemovalJobsRef.current.get(jobKey);
          if (
            currentJob !== job ||
            currentJob.requestToken !== job.requestToken ||
            currentJob.originalSrc !== item.src
          ) {
            return;
          }

          job.processedSrc = processedSrc;
          if (!gestureRef.current && !eraserGestureRef.current) {
            applyCompletedBackgroundRemoval(job);
          }
        },
        (error: unknown) => {
          if (backgroundRemovalJobsRef.current.get(jobKey) !== job) return;
          removeTrackedBackgroundRemovalJob(job);
          if (
            error instanceof BackgroundRemovalError &&
            error.category === 'aborted'
          ) {
            return;
          }
          const message = getBackgroundRemovalErrorMessage(error);
          const slideNumber =
            deckRef.current.slides.findIndex(
              (slide) => slide.id === job.slideId,
            ) + 1;
          setNotice(
            activeSlideIdRef.current === job.slideId || slideNumber < 1
              ? message
              : `Slide ${slideNumber}: ${message}`,
          );
        },
      );
    },
    [
      applyCompletedBackgroundRemoval,
      commit,
      focusItemFrame,
      removeTrackedBackgroundRemovalJob,
    ],
  );

  const addCopiedItem = useCallback(
    (source: TransformableCanvasItem, message: string) => {
      cancelActiveMarking();
      closeDrawingMenu();
      closeShapeMenu();
      const id = crypto.randomUUID();
      commit((items) => {
        const position = copiedItemPosition(source, items);
        const copy = {
          ...source,
          id,
          ...position,
        } satisfies TransformableCanvasItem;
        return [...items, copy];
      });
      setSelectedToolId('select');
      setSelectedItemId(id);
      setOpenItemMenuId(null);
      setOpenColorPickerId(null);
      setNotice(message);
    },
    [cancelActiveMarking, closeDrawingMenu, closeShapeMenu, commit],
  );

  const duplicateItem = useCallback(
    (item: TransformableCanvasItem) => {
      addCopiedItem(
        item,
        `${item.kind === 'shape' ? 'Shape' : 'Object'} duplicated.`,
      );
    },
    [addCopiedItem],
  );

  const copyItem = useCallback((item: TransformableCanvasItem) => {
    const label = clipboardLabel(item);
    const internalCopy = { ...item } satisfies TransformableCanvasItem;
    copiedItemRef.current = internalCopy;
    copiedItemLabelRef.current = label;
    copiedItemInternalOnlyRef.current = false;
    setOpenItemMenuId(null);
    copyEventHandledRef.current = false;

    try {
      document.execCommand('copy');
    } catch {
      // Fall through to the async clipboard or in-board clipboard.
    }
    if (copyEventHandledRef.current) return;

    copiedItemInternalOnlyRef.current = true;
    setNotice(
      `${item.kind === 'shape' ? 'Shape' : 'Object'} copied in this board.`,
    );
    if (!navigator.clipboard?.writeText) {
      return;
    }

    void navigator.clipboard.writeText(label).then(
      () => {
        if (copiedItemRef.current !== internalCopy) return;
        copiedItemInternalOnlyRef.current = false;
        setNotice(`${item.kind === 'shape' ? 'Shape' : 'Object'} copied.`);
      },
      () => {
        if (copiedItemRef.current !== internalCopy) return;
        // The board-local copy remains available while this page stays focused.
      },
    );
  }, []);

  const discardPendingStickyNote = useCallback((itemId: string) => {
    setSelectedItemId((current) => (current === itemId ? null : current));
    setOpenItemMenuId(null);
    setOpenColorPickerId(null);
    setPendingStickyNote((current) =>
      current?.note.id === itemId ? { ...current, discarding: true } : current,
    );

    const timeout = window.setTimeout(() => {
      setPendingStickyNote((current) =>
        current?.note.id === itemId ? null : current,
      );
      stickyNoteDiscardTimersRef.current =
        stickyNoteDiscardTimersRef.current.filter(
          (timer) => timer !== timeout,
        );
    }, 360);
    stickyNoteDiscardTimersRef.current.push(timeout);
  }, []);

  const finishStickyNoteEdit = useCallback(() => {
    if (!stickyNoteEdit) return;
    if (finishingStickyNoteIdRef.current === stickyNoteEdit.itemId) return;
    finishingStickyNoteIdRef.current = stickyNoteEdit.itemId;
    setStickyNoteEdit(null);
    window.queueMicrotask(() => {
      if (finishingStickyNoteIdRef.current === stickyNoteEdit.itemId) {
        finishingStickyNoteIdRef.current = null;
      }
    });

    if (activeSlideIdRef.current !== stickyNoteEdit.slideId) return;
    if (stickyNoteEdit.isNew) {
      if (!stickyNoteEdit.draft.trim()) {
        discardPendingStickyNote(stickyNoteEdit.itemId);
        return;
      }

      const pending =
        pendingStickyNote?.note.id === stickyNoteEdit.itemId
          ? pendingStickyNote.note
          : null;
      if (!pending) return;

      setPendingStickyNote(null);
      commit((items) => [
        ...items,
        { ...pending, text: stickyNoteEdit.draft },
      ]);
      return;
    }

    commit((items) => {
      const note = items.find((item) => item.id === stickyNoteEdit.itemId);
      if (
        !note ||
        note.kind !== 'sticky-note' ||
        note.text === stickyNoteEdit.draft
      ) {
        return items;
      }

      return items.map((item) =>
        item.id === stickyNoteEdit.itemId && item.kind === 'sticky-note'
          ? { ...item, text: stickyNoteEdit.draft }
          : item,
      );
    });
  }, [commit, discardPendingStickyNote, pendingStickyNote, stickyNoteEdit]);

  const beginStickyNoteEdit = useCallback(
    (note: CanvasStickyNote) => {
      const draft =
        stickyNoteEdit?.itemId === note.id ? stickyNoteEdit.draft : note.text;
      finishStickyNoteEdit();
      cancelActiveGesture();
      setSelectedItemId(note.id);
      setOpenItemMenuId(null);
      setOpenColorPickerId(null);
      setStickyNoteEdit({
        itemId: note.id,
        slideId: deck.activeSlideId,
        draft,
        isNew: false,
      });
    },
    [
      cancelActiveGesture,
      deck.activeSlideId,
      finishStickyNoteEdit,
      stickyNoteEdit,
    ],
  );

  const placeStickyNote = useCallback((clientX: number, clientY: number) => {
    if (!boardRef.current) return;
    finishStickyNoteEdit();
    cancelActiveGesture();
    const boardBounds = boardRef.current.getBoundingClientRect();
    const point = boardPoint(clientX, clientY, {
      left: boardBounds.left,
      top: boardBounds.top,
      width: boardBounds.width,
      height: boardBounds.height,
    });
    const id = crypto.randomUUID();
    const note = {
      kind: 'sticky-note',
      id,
      text: '',
      color: 'yellow',
      x: clamp(
        point.x,
        STICKY_NOTE_SIZE / 2,
        BOARD_WIDTH - STICKY_NOTE_SIZE / 2,
      ),
      y: clamp(
        point.y,
        STICKY_NOTE_SIZE / 2,
        BOARD_HEIGHT - STICKY_NOTE_SIZE / 2,
      ),
      width: STICKY_NOTE_SIZE,
      height: STICKY_NOTE_SIZE,
      rotation: 0,
    } satisfies CanvasStickyNote;

    setPendingStickyNote({
      note,
      slideId: deck.activeSlideId,
      discarding: false,
    });
    setSelectedToolId('select');
    setSelectedItemId(id);
    setOpenItemMenuId(null);
    setOpenColorPickerId(null);
    setStickyNoteEdit({
      itemId: id,
      slideId: deck.activeSlideId,
      draft: '',
      isNew: true,
    });
  }, [cancelActiveGesture, deck.activeSlideId, finishStickyNoteEdit]);

  const changeStickyNoteColor = useCallback(
    (itemId: string, color: StickyNoteColor) => {
      if (pendingStickyNote?.note.id === itemId) {
        setPendingStickyNote((current) =>
          current?.note.id === itemId && current.note.color !== color
            ? { ...current, note: { ...current.note, color } }
            : current,
        );
        setOpenColorPickerId(null);
        return;
      }

      commit((items) => {
        const note = items.find((item) => item.id === itemId);
        if (!note || note.kind !== 'sticky-note' || note.color === color) {
          return items;
        }

        return items.map((item) =>
          item.id === itemId && item.kind === 'sticky-note'
            ? { ...item, color }
            : item,
        );
      });
      setOpenColorPickerId(null);
    },
    [commit, pendingStickyNote],
  );

  const changeShapeColor = useCallback(
    (itemId: string, color: ShapeColor) => {
      commit((items) => {
        const shape = items.find((item) => item.id === itemId);
        if (!shape || shape.kind !== 'shape' || shape.color === color) {
          return items;
        }

        return items.map((item) =>
          item.id === itemId && item.kind === 'shape'
            ? { ...item, color }
            : item,
        );
      });
      setActiveShapeColor(color);
      setOpenColorPickerId(null);
    },
    [commit],
  );

  const chooseShape = useCallback(
    (shape: ShapeType) => {
      cancelActiveMarking();
      finishStickyNoteEdit();
      cancelActiveGesture();
      closeDrawingMenu();
      setActiveShape(shape);
      setSelectedToolId('shape');
      setSelectedItemId(null);
      setOpenItemMenuId(null);
      setOpenColorPickerId(null);
      closeShapeMenu(true);
    },
    [
      cancelActiveGesture,
      cancelActiveMarking,
      closeDrawingMenu,
      closeShapeMenu,
      finishStickyNoteEdit,
    ],
  );

  const selectTool = useCallback(
    (tool: Tool, toggleDrawingOptions = true) => {
      cancelActiveMarking();
      finishStickyNoteEdit();
      setOpenItemMenuId(null);
      setOpenColorPickerId(null);

      if (tool.id === 'pen' || tool.id === 'eraser') {
        cancelActiveGesture();
        setSelectedItemId(null);
        setSelectedToolId(tool.id);
        closeShapeMenu();
        if (tool.id === 'pen') {
          setIsDrawingMenuOpen((current) =>
            toggleDrawingOptions && selectedToolId === 'pen' ? !current : false,
          );
        } else {
          closeDrawingMenu();
        }
        return;
      }

      if (tool.id === 'shape') {
        cancelActiveGesture();
        setSelectedItemId(null);
        setSelectedToolId('shape');
        closeDrawingMenu();
        setIsShapeMenuOpen((current) =>
          toggleDrawingOptions
            ? selectedToolId === 'shape'
              ? !current
              : true
            : false,
        );
        return;
      }

      closeDrawingMenu();
      closeShapeMenu();
      setSelectedToolId(tool.id);
    },
    [
      cancelActiveGesture,
      cancelActiveMarking,
      closeDrawingMenu,
      closeShapeMenu,
      finishStickyNoteEdit,
      selectedToolId,
    ],
  );

  const pasteImages = useCallback(
    async (files: File[]) => {
      const targetSlideId = activeSlideIdRef.current;
      cancelActiveMarking();
      closeDrawingMenu();
      closeShapeMenu();
      cancelActiveGesture();
      setSelectedItemId(null);
      setOpenItemMenuId(null);
      setOpenColorPickerId(null);
      const results = await Promise.allSettled(files.map(decodeImageFile));
      const decoded = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );

      if (decoded.length === 0) {
        if (activeSlideIdRef.current === targetSlideId) {
          setNotice('That image format is not supported by this browser.');
        }
        return;
      }

      const additions = decoded.map((image) => {
        const size = fittedImageSize(image.naturalWidth, image.naturalHeight);
        return {
          kind: 'image',
          id: crypto.randomUUID(),
          src: image.src,
          name: image.name,
          x: BOARD_WIDTH / 2,
          y: BOARD_HEIGHT / 2,
          width: size.width,
          height: size.height,
          rotation: 0,
        } satisfies CanvasImage;
      });

      const gestureAtCompletion = gestureRef.current;
      const concurrentGesture =
        gestureAtCompletion?.slideId === targetSlideId
          ? {
              itemId: gestureAtCompletion.itemId,
              initialItem: gestureAtCompletion.initialItem,
            }
          : null;

      setDeckHistory((current) => {
        const targetSlide = current.present.slides.find(
          (slide) => slide.id === targetSlideId,
        );
        if (!targetSlide) return current;

        const beforeItems = concurrentGesture
          ? targetSlide.history.present.map((currentItem) =>
              currentItem.id === concurrentGesture.itemId
                ? concurrentGesture.initialItem
                : currentItem,
            )
          : targetSlide.history.present;
        const existingObjectCount = targetSlide.history.present.filter(
          (item) => item.kind !== 'stroke',
        ).length;
        const positioned = additions.map((image, index) => {
          const offset = ((existingObjectCount + index) % 5) * 22;
          return {
            ...image,
            x: clamp(
              image.x + offset,
              image.width / 2,
              BOARD_WIDTH - image.width / 2,
            ),
            y: clamp(
              image.y + offset,
              image.height / 2,
              BOARD_HEIGHT - image.height / 2,
            ),
          };
        });
        const beforeDeck = concurrentGesture
          ? {
              ...current.present,
              slides: current.present.slides.map((slide) =>
                slide.id === targetSlideId
                  ? {
                      ...slide,
                      history: { ...slide.history, present: beforeItems },
                    }
                  : slide,
              ),
            }
          : current.present;
        const slides = current.present.slides.map((slide) =>
          slide.id === targetSlideId
            ? {
                ...slide,
                history: {
                  past: addToPast(slide.history.past, beforeItems),
                  present: [...slide.history.present, ...positioned],
                  future: [],
                },
              }
            : slide,
        );

        return {
          past: addDeckToPast(current.past, beforeDeck),
          present: { ...current.present, slides },
          future: [],
        };
      });
      if (activeSlideIdRef.current === targetSlideId) {
        setSelectedItemId(
          concurrentGesture?.itemId ?? additions.at(-1)?.id ?? null,
        );
        setOpenItemMenuId(null);
        setOpenColorPickerId(null);
        setNotice(
          additions.length === 1
            ? 'Image pasted. Drag to move it and use the blue corners to resize.'
            : `${additions.length} images pasted.`,
        );
      }
    },
    [
      cancelActiveGesture,
      cancelActiveMarking,
      closeDrawingMenu,
      closeShapeMenu,
    ],
  );

  useEffect(() => {
    const handleCopy = (event: ClipboardEvent) => {
      if (isTextEntry(event.target) || !selectedItemId) {
        copiedItemRef.current = null;
        copiedItemLabelRef.current = null;
        copiedItemInternalOnlyRef.current = false;
        return;
      }
      const item = history.present.find(
        (candidate): candidate is TransformableCanvasItem =>
          candidate.id === selectedItemId && candidate.kind !== 'stroke',
      );
      if (!item || !event.clipboardData) return;

      const label = clipboardLabel(item);
      event.preventDefault();
      copiedItemRef.current = { ...item };
      copiedItemLabelRef.current = label;
      const canWriteCustomData =
        item.kind !== 'image' ||
        item.src.length + (item.backgroundRemovedSrc?.length ?? 0) <=
          MAX_CUSTOM_CLIPBOARD_SOURCE_CHARACTERS;
      let wroteCustomData = false;
      let wroteText = false;
      if (canWriteCustomData) {
        try {
          event.clipboardData.setData(ITEM_CLIPBOARD_TYPE, JSON.stringify(item));
          wroteCustomData = true;
        } catch {
          // The in-board copy below still retains both committed image variants.
        }
      }
      try {
        event.clipboardData.setData('text/plain', label);
        wroteText = true;
      } catch {
        // Some clipboard implementations reject large custom payloads.
      }
      copiedItemInternalOnlyRef.current = !wroteCustomData;
      copyEventHandledRef.current = true;
      setNotice(
        wroteCustomData || wroteText
          ? `${item.kind === 'shape' ? 'Shape' : 'Object'} copied.`
          : `${item.kind === 'shape' ? 'Shape' : 'Object'} copied in this board.`,
      );
    };

    const handlePaste = (event: ClipboardEvent) => {
      if (isTextEntry(event.target)) return;

      const serializedItem = event.clipboardData?.getData(ITEM_CLIPBOARD_TYPE);
      if (serializedItem) {
        try {
          const item: unknown = JSON.parse(serializedItem);
          if (isClipboardItem(item)) {
            event.preventDefault();
            addCopiedItem(
              item,
              `${item.kind === 'shape' ? 'Shape' : 'Object'} pasted.`,
            );
            return;
          }
        } catch {
          // Ignore malformed clipboard data and continue to supported files.
        }
      }

      const clipboardText = event.clipboardData?.getData('text/plain');
      const itemFiles = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      const files =
        itemFiles.length > 0
          ? itemFiles
          : Array.from(event.clipboardData?.files ?? []);
      if (
        copiedItemRef.current &&
        (clipboardText === copiedItemLabelRef.current ||
          (copiedItemInternalOnlyRef.current && files.length === 0))
      ) {
        event.preventDefault();
        addCopiedItem(
          copiedItemRef.current,
          `${copiedItemRef.current.kind === 'shape' ? 'Shape' : 'Object'} pasted.`,
        );
        return;
      }

      if (files.length === 0) return;
      event.preventDefault();
      void pasteImages(files);
    };

    window.addEventListener('copy', handleCopy);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('copy', handleCopy);
      window.removeEventListener('paste', handlePaste);
    };
  }, [addCopiedItem, history.present, pasteImages, selectedItemId]);

  useEffect(() => {
    const clearInternalClipboardFallback = () => {
      if (!copiedItemInternalOnlyRef.current) return;
      copiedItemRef.current = null;
      copiedItemLabelRef.current = null;
      copiedItemInternalOnlyRef.current = false;
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearInternalClipboardFallback();
      }
    };

    window.addEventListener('blur', clearInternalClipboardFallback);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('blur', clearInternalClipboardFallback);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) return;

      if (event.key === 'Escape') {
        if (
          inkGestureRef.current ||
          eraserGestureRef.current ||
          shapeGestureRef.current
        ) {
          event.preventDefault();
          cancelActiveMarking();
          return;
        }

        if (isDrawingMenuOpen) {
          event.preventDefault();
          closeDrawingMenu(true);
          return;
        }

        if (isShapeMenuOpen) {
          event.preventDefault();
          closeShapeMenu(true);
          return;
        }

        if (openSlideMenuId) {
          event.preventDefault();
          closeSlideMenu(true);
          return;
        }

        if (openItemMenuId) {
          event.preventDefault();
          const itemId = openItemMenuId;
          setOpenItemMenuId(null);
          window.requestAnimationFrame(() => {
            itemMenuButtonRefsRef.current
              .get(itemId)
              ?.focus({ preventScroll: true });
          });
          return;
        }

        closeSlideOverview('counter');
        setOpenItemMenuId(null);
        setOpenColorPickerId(null);
        setSelectedItemId(null);
        return;
      }

      const key = event.key.toLowerCase();
      const commandKey = event.ctrlKey || event.metaKey;

      if (commandKey && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if (commandKey && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }

      if (
        !commandKey &&
        !event.altKey &&
        !event.shiftKey &&
        !isSlideOverviewOpen &&
        (key === 'p' || key === 'e')
      ) {
        const shortcutTool = tools.find(
          (tool) => tool.shortcut?.toLowerCase() === key,
        );
        if (shortcutTool) {
          event.preventDefault();
          selectTool(shortcutTool, false);
          return;
        }
      }

      if (isDrawingMenuOpen || isShapeMenuOpen) return;

      const isHorizontalArrow =
        event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      const canNavigateWithArrows =
        isSlideOverviewOpen || (!selectedItemId && !openItemMenuId);

      if (
        isHorizontalArrow &&
        canNavigateWithArrows &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        navigateToAdjacentSlide(event.key === 'ArrowLeft' ? -1 : 1);
        return;
      }

      if (
        isSlideOverviewOpen &&
        (event.key === 'Delete' || event.key === 'Backspace')
      ) {
        event.preventDefault();
        deleteSlide(deck.activeSlideId);
        return;
      }

      if (isSlideOverviewOpen) return;

      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selectedItemId
      ) {
        event.preventDefault();
        deleteItem(selectedItemId);
        return;
      }

    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    closeSlideOverview,
    closeDrawingMenu,
    closeShapeMenu,
    closeSlideMenu,
    cancelActiveMarking,
    deck.activeSlideId,
    deleteItem,
    deleteSlide,
    isSlideOverviewOpen,
    isDrawingMenuOpen,
    isShapeMenuOpen,
    navigateToAdjacentSlide,
    openItemMenuId,
    openSlideMenuId,
    redo,
    selectTool,
    selectedItemId,
    undo,
  ]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    Array.from(backgroundRemovalJobsRef.current.values()).forEach((job) => {
      const slide = deck.slides.find((candidate) => candidate.id === job.slideId);
      const image = slide?.history.present.find(
        (item): item is CanvasImage =>
          item.id === job.itemId && item.kind === 'image',
      );
      if (!image || image.src !== job.originalSrc) {
        removeTrackedBackgroundRemovalJob(job, true);
      }
    });
  }, [deck, removeTrackedBackgroundRemovalJob]);

  useEffect(
    () => () => {
      stickyNoteDiscardTimersRef.current.forEach((timer) =>
        window.clearTimeout(timer),
      );
      if (inkRenderFrameRef.current !== null) {
        window.cancelAnimationFrame(inkRenderFrameRef.current);
      }
      backgroundRemovalJobsRef.current.forEach((job) =>
        job.controller.abort(),
      );
      backgroundRemovalJobsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!isDrawingMenuOpen) return;

    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-drawing-menu]')) return;
      closeDrawingMenu();
    };

    document.addEventListener('pointerdown', closeMenu, true);
    return () => document.removeEventListener('pointerdown', closeMenu, true);
  }, [closeDrawingMenu, isDrawingMenuOpen]);

  useEffect(() => {
    if (!isShapeMenuOpen) return;

    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-shape-menu]')) return;
      closeShapeMenu();
    };

    document.addEventListener('pointerdown', closeMenu, true);
    return () => document.removeEventListener('pointerdown', closeMenu, true);
  }, [closeShapeMenu, isShapeMenuOpen]);

  useEffect(() => {
    if (!openItemMenuId) return;

    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(`[data-item-menu="${openItemMenuId}"]`)) return;
      setOpenItemMenuId(null);
    };

    document.addEventListener('pointerdown', closeMenu, true);
    return () => document.removeEventListener('pointerdown', closeMenu, true);
  }, [openItemMenuId]);

  useEffect(() => {
    if (!openItemMenuId || !focusItemMenuOnOpenRef.current) return;
    focusItemMenuOnOpenRef.current = false;
    const animationFrame = window.requestAnimationFrame(() => {
      const anchor = itemMenuButtonRefsRef.current
        .get(openItemMenuId)
        ?.closest<HTMLElement>('[data-item-menu]');
      anchor
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [openItemMenuId]);

  useEffect(() => {
    if (!openColorPickerId) return;

    const closeColorPicker = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(`[data-color-picker="${openColorPickerId}"]`)) {
        return;
      }
      setOpenColorPickerId(null);
    };

    document.addEventListener('pointerdown', closeColorPicker, true);
    return () =>
      document.removeEventListener('pointerdown', closeColorPicker, true);
  }, [openColorPickerId]);

  useEffect(() => {
    if (!openColorPickerId || !focusColorPickerOnOpenRef.current) return;
    focusColorPickerOnOpenRef.current = false;
    const animationFrame = window.requestAnimationFrame(() => {
      activeColorChoiceRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [openColorPickerId]);

  useEffect(() => {
    if (!openSlideMenuId) return;

    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const menu = event.target.closest('[data-slide-menu]');
      if (menu?.getAttribute('data-slide-menu') === openSlideMenuId) return;
      closeSlideMenu();
    };

    document.addEventListener('pointerdown', closeMenu, true);
    return () => document.removeEventListener('pointerdown', closeMenu, true);
  }, [closeSlideMenu, openSlideMenuId]);

  const startGesture = (
    event: ReactPointerEvent<HTMLElement>,
    item: TransformableCanvasItem,
    kind: Gesture['kind'],
    corner?: ResizeCorner,
  ) => {
    if (event.button !== 0 || !boardRef.current) return;

    event.preventDefault();
    event.stopPropagation();
    const itemAtStart =
      item.kind === 'sticky-note' && stickyNoteEdit?.itemId === item.id
        ? { ...item, text: stickyNoteEdit.draft }
        : item;
    finishStickyNoteEdit();
    const rect = boardRef.current.getBoundingClientRect();
    const compactRect: BoardRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    const startPoint = boardPoint(event.clientX, event.clientY, compactRect);
    const initialIndex = history.present.findIndex(
      (currentItem) => currentItem.id === itemAtStart.id,
    );
    const lastItemIndex = history.present.length - 1;
    const broughtToFront =
      initialIndex >= 0 && initialIndex !== lastItemIndex;

    gestureRef.current = {
      kind,
      pointerId: event.pointerId,
      slideId: deck.activeSlideId,
      itemId: itemAtStart.id,
      initialItem: itemAtStart,
      initialIndex,
      broughtToFront,
      boardRect: compactRect,
      startPoint,
      startAngle:
        kind === 'rotate'
          ? Math.atan2(startPoint.y - itemAtStart.y, startPoint.x - itemAtStart.x) *
            (180 / Math.PI)
          : undefined,
      corner,
      moved: false,
    };
    if (broughtToFront) {
      setDeck((current) => ({
        ...current,
        slides: current.slides.map((slide) =>
          slide.id === deck.activeSlideId
            ? {
                ...slide,
                history: {
                  ...slide.history,
                  present: bringItemToFront(
                    slide.history.present,
                    itemAtStart.id,
                  ),
                },
              }
            : slide,
        ),
      }));
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedToolId('select');
    setSelectedItemId(itemAtStart.id);
    setOpenItemMenuId(null);
    setOpenColorPickerId(null);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    event.preventDefault();
    const point = boardPoint(event.clientX, event.clientY, gesture.boardRect);
    const item = gesture.initialItem;
    let nextItem = item;

    if (gesture.kind === 'move') {
      const deltaX = point.x - gesture.startPoint.x;
      const deltaY = point.y - gesture.startPoint.y;
      const extents = rotatedItemExtents(item);

      nextItem = {
        ...item,
        x: clamp(
          item.x + deltaX,
          extents.horizontal,
          BOARD_WIDTH - extents.horizontal,
        ),
        y: clamp(
          item.y + deltaY,
          extents.vertical,
          BOARD_HEIGHT - extents.vertical,
        ),
      };
    } else if (gesture.kind === 'resize' && gesture.corner) {
      nextItem = resizedItem(
        item,
        gesture.corner,
        point,
        item.kind !== 'shape' || item.shape === 'square' || event.shiftKey,
        item.kind === 'shape' ? MIN_SHAPE_DRAW_SIZE : undefined,
      );
    } else if (gesture.kind === 'rotate' && gesture.startAngle !== undefined) {
      const pointerAngle =
        Math.atan2(point.y - item.y, point.x - item.x) * (180 / Math.PI);
      let rotation = item.rotation + pointerAngle - gesture.startAngle;
      if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
      nextItem = { ...item, rotation };
    }

    const changed =
      Math.abs(nextItem.x - item.x) > 0.01 ||
      Math.abs(nextItem.y - item.y) > 0.01 ||
      Math.abs(nextItem.width - item.width) > 0.01 ||
      Math.abs(nextItem.height - item.height) > 0.01 ||
      Math.abs(nextItem.rotation - item.rotation) > 0.01;

    if (!changed) return;
    gesture.moved = true;
    setDeck((current) => {
      if (current.activeSlideId !== gesture.slideId) return current;

      return {
        ...current,
        slides: current.slides.map((slide) =>
          slide.id === gesture.slideId
            ? {
                ...slide,
                history: {
                  ...slide.history,
                  present: slide.history.present.map((currentItem) =>
                    currentItem.id === gesture.itemId ? nextItem : currentItem,
                  ),
                },
              }
            : slide,
        ),
      };
    });
  };

  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    gestureRef.current = null;
    if (!gesture.moved && !gesture.broughtToFront) {
      flushCompletedBackgroundRemovals();
      return;
    }

    setDeckHistory((current) => {
      if (current.present.activeSlideId !== gesture.slideId) return current;

      const targetSlide = current.present.slides.find(
        (slide) => slide.id === gesture.slideId,
      );
      if (!targetSlide) return current;

      const beforeItems = restoreGestureStart(
        targetSlide.history.present,
        gesture,
      );
      const beforeDeck = {
        ...current.present,
        slides: current.present.slides.map((slide) =>
          slide.id === gesture.slideId
            ? {
                ...slide,
                history: { ...slide.history, present: beforeItems },
              }
            : slide,
        ),
      };
      const slides = current.present.slides.map((slide) =>
        slide.id === gesture.slideId
          ? {
              ...slide,
              history: {
                past: addToPast(slide.history.past, beforeItems),
                present: slide.history.present.map((item) =>
                  item.id === gesture.itemId && item.kind !== 'stroke'
                    ? { ...item, rotation: normalizeRotation(item.rotation) }
                    : item,
                ),
                future: [],
              },
            }
          : slide,
      );

      return {
        past: addDeckToPast(current.past, beforeDeck),
        present: { ...current.present, slides },
        future: [],
      };
    });
    flushCompletedBackgroundRemovals();
  };

  const appendPointerEventToInk = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const gesture = inkGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return null;

    const coalescedEvents = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const samples =
      coalescedEvents.length > 0
        ? coalescedEvents
        : [event.nativeEvent];
    const candidates: StrokePoint[] = samples.map((sample) => {
      const point = boardPoint(
        sample.clientX,
        sample.clientY,
        gesture.boardRect,
      );
      const rawTime = Number.isFinite(sample.timeStamp)
        ? sample.timeStamp
        : gesture.lastSample.time + 16.67;
      const sampleTime =
        rawTime > gesture.lastSample.time
          ? rawTime
          : gesture.lastSample.time + 1;
      const elapsed = sampleTime - gesture.lastSample.time;
      const horizontalScale = gesture.boardRect.width / BOARD_WIDTH;
      const verticalScale = gesture.boardRect.height / BOARD_HEIGHT;
      const distance = Math.hypot(
        (point.x - gesture.lastSample.x) * horizontalScale,
        (point.y - gesture.lastSample.y) * verticalScale,
      );
      const rawVelocity = distance / elapsed;
      if (gesture.velocity === null) {
        if (distance > 0.01) gesture.velocity = rawVelocity;
      } else {
        const blend = 1 - Math.exp(-elapsed / 28);
        gesture.velocity += (rawVelocity - gesture.velocity) * blend;
      }
      gesture.lastSample = { ...point, time: sampleTime };

      return { ...point, velocity: gesture.velocity ?? 0 };
    });
    const appended = appendStrokePoints(gesture.stroke.points, candidates);

    if (appended && inkRenderFrameRef.current === null) {
      inkRenderFrameRef.current = window.requestAnimationFrame(() => {
        inkRenderFrameRef.current = null;
        if (!inkGestureRef.current) return;
        activeInkRendererRef.current?.redraw();
      });
    }

    return gesture;
  };

  const startInkStroke = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      inkGestureRef.current
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    finishStickyNoteEdit();
    cancelActiveGesture();
    closeDrawingMenu();
    closeShapeMenu();
    setSelectedItemId(null);
    setOpenItemMenuId(null);
    setOpenColorPickerId(null);

    const rect = event.currentTarget.getBoundingClientRect();
    const boardRect: BoardRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    const point = boardPoint(event.clientX, event.clientY, boardRect);
    const sampleTime = Number.isFinite(event.nativeEvent.timeStamp)
      ? event.nativeEvent.timeStamp
      : 0;
    const stroke: CanvasStroke = {
      kind: 'stroke',
      id: crypto.randomUUID(),
      style: drawingStyle,
      color: drawingColor,
      points: [
        {
          x: clamp(point.x, 0, BOARD_WIDTH),
          y: clamp(point.y, 0, BOARD_HEIGHT),
          velocity: 0,
        },
      ],
    };

    inkGestureRef.current = {
      pointerId: event.pointerId,
      slideId: deck.activeSlideId,
      boardRect,
      stroke,
      lastSample: {
        x: clamp(point.x, 0, BOARD_WIDTH),
        y: clamp(point.y, 0, BOARD_HEIGHT),
        time: sampleTime,
      },
      velocity: null,
    };
    setPendingStroke(stroke);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveInkStroke = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!inkGestureRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    appendPointerEventToInk(event);
  };

  const finishInkStroke = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = appendPointerEventToInk(event);
    if (!gesture) return;

    event.preventDefault();
    event.stopPropagation();
    if (inkRenderFrameRef.current !== null) {
      window.cancelAnimationFrame(inkRenderFrameRef.current);
      inkRenderFrameRef.current = null;
    }
    inkGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPendingStroke(null);

    if (activeSlideIdRef.current !== gesture.slideId) return;
    const completedStroke = {
      ...gesture.stroke,
      points: [...gesture.stroke.points],
    };
    commit((currentItems) => [...currentItems, completedStroke]);
  };

  const applyEraserSweeps = (
    gesture: EraserGesture,
    sweeps: EraserSweep[],
  ) => {
    if (sweeps.length === 0) return;
    const nextItems = applyEraserTraceToItems(
      gesture.workingItems,
      gesture.trace,
      sweeps,
    );
    if (nextItems === gesture.workingItems) return;

    gesture.workingItems = nextItems;
    setPendingErase({ slideId: gesture.slideId, items: nextItems });
  };

  const appendPointerEventToEraser = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const gesture = eraserGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return null;

    const coalescedEvents = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const samples =
      coalescedEvents.length > 0 ? coalescedEvents : [event.nativeEvent];
    const sweeps: EraserSweep[] = [];
    const horizontalScale = gesture.boardRect.width / BOARD_WIDTH;
    const verticalScale = gesture.boardRect.height / BOARD_HEIGHT;

    for (const sample of samples) {
      const rawPoint = boardPoint(
        sample.clientX,
        sample.clientY,
        gesture.boardRect,
      );
      const point = {
        x: clamp(rawPoint.x, 0, BOARD_WIDTH),
        y: clamp(rawPoint.y, 0, BOARD_HEIGHT),
      };
      const rawTime = Number.isFinite(sample.timeStamp)
        ? sample.timeStamp
        : gesture.lastSample.time + 16.67;
      const sampleTime =
        rawTime > gesture.lastSample.time
          ? rawTime
          : gesture.lastSample.time + 1;
      const elapsed = sampleTime - gesture.lastSample.time;
      const distance = Math.hypot(
        (point.x - gesture.lastSample.x) * horizontalScale,
        (point.y - gesture.lastSample.y) * verticalScale,
      );

      if (distance < 0.12) {
        gesture.lastSample = { ...gesture.lastSample, time: sampleTime };
        continue;
      }

      const rawVelocity = distance / elapsed;
      if (gesture.velocity === null) {
        gesture.velocity = rawVelocity;
      } else {
        const blend = 1 - Math.exp(-elapsed / 28);
        gesture.velocity += (rawVelocity - gesture.velocity) * blend;
      }

      const nextPoint: EraserPoint = {
        ...point,
        radius: eraserRadiusInBoardUnits(
          gesture.boardRect,
          gesture.velocity,
        ),
      };
      const previousPoint: EraserPoint = {
        x: gesture.lastSample.x,
        y: gesture.lastSample.y,
        radius: gesture.lastSample.radius,
      };
      const sweep = { from: previousPoint, to: nextPoint };
      gesture.trace.points.push(nextPoint);
      gesture.sweeps.push(sweep);
      sweeps.push(sweep);
      gesture.lastSample = { ...nextPoint, time: sampleTime };
    }

    applyEraserSweeps(gesture, sweeps);
    setEraserPreview({
      x: gesture.lastSample.x,
      y: gesture.lastSample.y,
      radius: gesture.lastSample.radius,
    });
    return gesture;
  };

  const startEraserStroke = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      eraserGestureRef.current
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    finishStickyNoteEdit();
    cancelActiveGesture();
    closeDrawingMenu();
    closeShapeMenu();
    setSelectedItemId(null);
    setOpenItemMenuId(null);
    setOpenColorPickerId(null);

    const rect = event.currentTarget.getBoundingClientRect();
    const boardRect: BoardRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    const rawPoint = boardPoint(event.clientX, event.clientY, boardRect);
    const point: EraserPoint = {
      x: clamp(rawPoint.x, 0, BOARD_WIDTH),
      y: clamp(rawPoint.y, 0, BOARD_HEIGHT),
      radius: eraserRadiusInBoardUnits(boardRect, 0),
    };
    const sampleTime = Number.isFinite(event.nativeEvent.timeStamp)
      ? event.nativeEvent.timeStamp
      : 0;
    const trace: EraserTrace = {
      id: crypto.randomUUID(),
      points: [point],
    };
    const initialSweep = { from: point, to: point };
    const gesture: EraserGesture = {
      pointerId: event.pointerId,
      slideId: deck.activeSlideId,
      boardRect,
      initialItems: history.present,
      workingItems: history.present,
      trace,
      sweeps: [initialSweep],
      lastSample: { ...point, time: sampleTime },
      velocity: null,
    };

    eraserGestureRef.current = gesture;
    setPendingErase({ slideId: gesture.slideId, items: gesture.workingItems });
    setEraserPreview(point);
    applyEraserSweeps(gesture, [initialSweep]);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const showEraserPreview = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (eraserGestureRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const boardRect: BoardRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    const point = boardPoint(event.clientX, event.clientY, boardRect);
    setEraserPreview({
      x: clamp(point.x, 0, BOARD_WIDTH),
      y: clamp(point.y, 0, BOARD_HEIGHT),
      radius: eraserRadiusInBoardUnits(boardRect, 0),
    });
  };

  const moveEraserStroke = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!eraserGestureRef.current) {
      showEraserPreview(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    appendPointerEventToEraser(event);
  };

  const finishEraserStroke = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = appendPointerEventToEraser(event);
    if (!gesture) return;

    event.preventDefault();
    event.stopPropagation();
    eraserGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPendingErase(null);
    setEraserPreview(
      event.pointerType === 'touch'
        ? null
        : {
            x: gesture.lastSample.x,
            y: gesture.lastSample.y,
            radius: gesture.lastSample.radius,
          },
    );

    if (
      activeSlideIdRef.current !== gesture.slideId ||
      gesture.workingItems === gesture.initialItems
    ) {
      return;
    }

    const completedItems = gesture.workingItems;
    const completedTrace: EraserTrace = {
      id: gesture.trace.id,
      points: gesture.trace.points.map((point) => ({ ...point })),
    };
    const completedSweeps = gesture.sweeps.map((sweep) => ({
      from: { ...sweep.from },
      to: { ...sweep.to },
    }));
    commit((currentItems) =>
      currentItems === gesture.initialItems
        ? completedItems
        : applyEraserTraceToItems(
            currentItems,
            completedTrace,
            completedSweeps,
          ),
    );
  };

  const cancelEraserStroke = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = eraserGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    cancelActiveEraser();
  };

  const cancelInkStroke = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = inkGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    cancelActiveInk();
  };

  const startShapeCreation = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      shapeGestureRef.current
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    finishStickyNoteEdit();
    cancelActiveGesture();
    closeDrawingMenu();
    closeShapeMenu();
    setSelectedItemId(null);
    setOpenItemMenuId(null);
    setOpenColorPickerId(null);

    const rect = event.currentTarget.getBoundingClientRect();
    const boardRect: BoardRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    const rawPoint = boardPoint(event.clientX, event.clientY, boardRect);
    const startPoint = {
      x: clamp(rawPoint.x, 0, BOARD_WIDTH),
      y: clamp(rawPoint.y, 0, BOARD_HEIGHT),
    };
    const shape: CanvasShape = {
      kind: 'shape',
      id: crypto.randomUUID(),
      shape: activeShape,
      color: activeShapeColor,
      arrowDirection: 'right',
      filled: true,
      x: startPoint.x,
      y: startPoint.y,
      width: 0,
      height: 0,
      rotation: 0,
    };

    shapeGestureRef.current = {
      pointerId: event.pointerId,
      slideId: deck.activeSlideId,
      boardRect,
      startPoint,
      shape,
    };
    setPendingShape({ shape, slideId: deck.activeSlideId });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateShapeCreation = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = shapeGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return null;

    event.preventDefault();
    event.stopPropagation();
    const rawPoint = boardPoint(
      event.clientX,
      event.clientY,
      gesture.boardRect,
    );
    const point = {
      x: clamp(rawPoint.x, 0, BOARD_WIDTH),
      y: clamp(rawPoint.y, 0, BOARD_HEIGHT),
    };
    const deltaX = point.x - gesture.startPoint.x;
    const deltaY = point.y - gesture.startPoint.y;

    if (gesture.shape.shape === 'square') {
      const horizontalDirection =
        deltaX === 0
          ? gesture.startPoint.x <= BOARD_WIDTH / 2
            ? 1
            : -1
          : Math.sign(deltaX);
      const verticalDirection =
        deltaY === 0
          ? gesture.startPoint.y <= BOARD_HEIGHT / 2
            ? 1
            : -1
          : Math.sign(deltaY);
      const horizontalRoom =
        horizontalDirection > 0
          ? BOARD_WIDTH - gesture.startPoint.x
          : gesture.startPoint.x;
      const verticalRoom =
        verticalDirection > 0
          ? BOARD_HEIGHT - gesture.startPoint.y
          : gesture.startPoint.y;
      const side = Math.min(
        Math.max(Math.abs(deltaX), Math.abs(deltaY)),
        horizontalRoom,
        verticalRoom,
      );

      gesture.shape = {
        ...gesture.shape,
        x: gesture.startPoint.x + (horizontalDirection * side) / 2,
        y: gesture.startPoint.y + (verticalDirection * side) / 2,
        width: side,
        height: side,
      };
    } else {
      gesture.shape = {
        ...gesture.shape,
        arrowDirection:
          gesture.shape.shape === 'arrow'
            ? deltaX < 0
              ? 'left'
              : deltaX > 0
                ? 'right'
                : gesture.shape.arrowDirection
            : gesture.shape.arrowDirection,
        x: (gesture.startPoint.x + point.x) / 2,
        y: (gesture.startPoint.y + point.y) / 2,
        width: Math.abs(deltaX),
        height: Math.abs(deltaY),
      };
    }
    setPendingShape({ shape: gesture.shape, slideId: gesture.slideId });
    return gesture;
  };

  const finishShapeCreation = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = updateShapeCreation(event);
    if (!gesture) return;

    shapeGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPendingShape(null);

    const completedShape = gesture.shape;
    if (
      activeSlideIdRef.current !== gesture.slideId ||
      completedShape.width < MIN_SHAPE_DRAW_SIZE ||
      completedShape.height < MIN_SHAPE_DRAW_SIZE
    ) {
      return;
    }

    commit((items) => [...items, completedShape]);
    setSelectedToolId('select');
    setSelectedItemId(completedShape.id);
  };

  const cancelShapeCreation = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = shapeGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    cancelActiveShape();
  };

  const clearCanvasSelection = useCallback(() => {
    cancelActiveMarking();
    closeDrawingMenu();
    closeShapeMenu();
    cancelActiveGesture();
    setSelectedItemId(null);
    setOpenItemMenuId(null);
    setOpenColorPickerId(null);
    setStickyNoteEdit(null);
    setPendingStickyNote(null);
    closeSlideMenu();
  }, [
    cancelActiveGesture,
    cancelActiveMarking,
    closeDrawingMenu,
    closeShapeMenu,
    closeSlideMenu,
  ]);

  const selectSlide = useCallback(
    (slideId: string) => {
      clearCanvasSelection();
      setDeck((current) =>
        current.slides.some((slide) => slide.id === slideId)
          ? { ...current, activeSlideId: slideId }
          : current,
      );
    },
    [clearCanvasSelection, setDeck],
  );

  const goToPreviousSlide = useCallback(() => {
    navigateToAdjacentSlide(-1);
  }, [navigateToAdjacentSlide]);

  const goToNextSlide = useCallback(() => {
    const newSlideId = crypto.randomUUID();
    clearCanvasSelection();
    setDeckHistory((current) => {
      const currentIndex = current.present.slides.findIndex(
        (slide) => slide.id === current.present.activeSlideId,
      );
      const nextSlide = current.present.slides[currentIndex + 1];

      if (nextSlide) {
        return {
          ...current,
          present: { ...current.present, activeSlideId: nextSlide.id },
        };
      }
      if (current.present.slides.length >= MAX_SLIDES) return current;

      const present = {
        slides: [...current.present.slides, createEmptySlide(newSlideId)],
        activeSlideId: newSlideId,
      };

      return {
        past: addDeckToPast(current.past, current.present),
        present,
        future: [],
      };
    });
  }, [clearCanvasSelection]);

  const insertSlideAfter = useCallback(
    (slideId: string) => {
      const newSlideId = crypto.randomUUID();
      clearCanvasSelection();
      setDeckHistory((current) => {
        if (current.present.slides.length >= MAX_SLIDES) return current;
        const index = current.present.slides.findIndex(
          (slide) => slide.id === slideId,
        );
        if (index < 0) return current;

        const present = {
          slides: [
            ...current.present.slides.slice(0, index + 1),
            createEmptySlide(newSlideId),
            ...current.present.slides.slice(index + 1),
          ],
          activeSlideId: newSlideId,
        };

        return {
          past: addDeckToPast(current.past, current.present),
          present,
          future: [],
        };
      });
    },
    [clearCanvasSelection],
  );

  const updateOverviewScrollAvailability = useCallback(() => {
    const viewport = overviewViewportRef.current;
    if (!viewport) return;
    const maximumScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const next = {
      left: viewport.scrollLeft > 1,
      right: viewport.scrollLeft < maximumScroll - 1,
    };
    setOverviewScrollAvailability((current) =>
      current.left === next.left && current.right === next.right ? current : next,
    );
  }, []);

  const scrollSlideOverview = useCallback(
    (direction: -1 | 1) => {
      const viewport = overviewViewportRef.current;
      if (!viewport) return;
      viewport.scrollBy({
        left: direction * Math.max(277, viewport.clientWidth * 0.72),
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      });
    },
    [],
  );

  useEffect(() => {
    if (!isSlideOverviewOpen) {
      if (wasSlideOverviewOpenRef.current) {
        wasSlideOverviewOpenRef.current = false;
        const focusTarget = overviewReturnFocusRef.current;
        overviewReturnFocusRef.current = 'counter';
        const animationFrame = window.requestAnimationFrame(() => {
          if (focusTarget === 'canvas') {
            boardRef.current?.focus({ preventScroll: true });
          } else {
            frameCounterRef.current?.focus({ preventScroll: true });
          }
        });
        return () => window.cancelAnimationFrame(animationFrame);
      }
      return;
    }

    wasSlideOverviewOpenRef.current = true;
    const animationFrame = window.requestAnimationFrame(() => {
      activeThumbnailRef.current?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      });
      activeThumbnailRef.current?.focus({ preventScroll: true });
      updateOverviewScrollAvailability();
    });
    window.addEventListener('resize', updateOverviewScrollAvailability);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', updateOverviewScrollAvailability);
    };
  }, [
    deck.activeSlideId,
    deck.slides.length,
    isSlideOverviewOpen,
    updateOverviewScrollAvailability,
  ]);

  const visibleHistoryItems =
    pendingErase?.slideId === deck.activeSlideId
      ? pendingErase.items
      : history.present;
  const itemsWithStickyNote =
    pendingStickyNote?.slideId === deck.activeSlideId
      ? [...visibleHistoryItems, pendingStickyNote.note]
      : visibleHistoryItems;
  const items =
    pendingShape?.slideId === deck.activeSlideId
      ? [...itemsWithStickyNote, pendingShape.shape]
      : itemsWithStickyNote;
  const inkRuns = getInkRuns(items);
  const canvasObjects = items.filter((item) => item.kind !== 'stroke');
  const itemLayer = new Map(
    items.map((item, index) => [item.id, index + 1] as const),
  );

  return (
    <main className="app-shell">
      <header className="topbar" inert={isSlideOverviewOpen}>
        <div className="document-title">Untitled Jam</div>

        <nav className="frame-navigation" aria-label="Slide navigation">
          <button
            type="button"
            className="frame-nav-button previous-frame"
            aria-label="Previous slide"
            disabled={activeSlideIndex === 0}
            onClick={goToPreviousSlide}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <button
            ref={frameCounterRef}
            type="button"
            className="frame-counter"
            aria-label={`Slide ${activeSlideIndex + 1} of ${deck.slides.length}. ${
              isSlideOverviewOpen ? 'Close' : 'Open'
            } slide overview`}
            aria-expanded={isSlideOverviewOpen}
            aria-controls="slide-overview"
            onClick={() => {
              clearCanvasSelection();
              if (isSlideOverviewOpen) {
                closeSlideOverview('counter');
              } else {
                setIsSlideOverviewOpen(true);
              }
            }}
          >
            <span>
              {activeSlideIndex + 1}/{deck.slides.length}
            </span>
          </button>
          <button
            type="button"
            className="frame-nav-button next-frame"
            aria-label={
              activeSlideIndex < deck.slides.length - 1
                ? 'Next slide'
                : 'Create new slide'
            }
            disabled={
              activeSlideIndex === deck.slides.length - 1 &&
              deck.slides.length >= MAX_SLIDES
            }
            onClick={goToNextSlide}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </nav>

        <div className="top-actions" aria-hidden="true">
          <div className="account-control">
            <UserRound />
          </div>
        </div>
      </header>

      <button
        type="button"
        className={`slide-overview-dismiss-layer${
          isSlideOverviewOpen ? ' is-open' : ''
        }`}
        aria-label="Close slide overview and return to canvas"
        aria-hidden={isSlideOverviewOpen ? undefined : true}
        tabIndex={-1}
        onClick={() => closeSlideOverview('canvas')}
      />

      <section
        id="slide-overview"
        className={`slide-overview${isSlideOverviewOpen ? ' is-open' : ''}`}
        aria-label="All slides"
        aria-hidden={isSlideOverviewOpen ? undefined : true}
        inert={!isSlideOverviewOpen}
      >
          <button
            type="button"
            className="overview-scroll-button overview-scroll-left"
            aria-label="Scroll slide previews left"
            disabled={!overviewScrollAvailability.left}
            onClick={() => scrollSlideOverview(-1)}
          >
            <ChevronLeft aria-hidden="true" />
          </button>

          <div
            ref={overviewViewportRef}
            className="slide-overview-viewport"
            onScroll={updateOverviewScrollAvailability}
          >
            <div className="slide-overview-list">
              {deck.slides.map((slide, index) => {
                const isActive = slide.id === deck.activeSlideId;

                return (
                  <div className="slide-overview-group" key={slide.id}>
                    <div className="slide-overview-card">
                      <span className="slide-number" aria-hidden="true">
                        {index + 1}
                      </span>
                      <div className="slide-thumbnail-wrap">
                        <button
                          ref={isActive ? activeThumbnailRef : undefined}
                          type="button"
                          className={`slide-thumbnail${isActive ? ' is-active' : ''}`}
                          aria-label={`Go to slide ${index + 1}`}
                          aria-current={isActive ? 'page' : undefined}
                          onClick={() => selectSlide(slide.id)}
                        >
                          <SlidePreview items={slide.history.present} />
                        </button>
                        {isActive ? (
                          <div
                            className="slide-options"
                            data-slide-menu={slide.id}
                            onBlur={(event) => {
                              if (
                                event.relatedTarget instanceof Node &&
                                event.currentTarget.contains(event.relatedTarget)
                              ) {
                                return;
                              }
                              closeSlideMenu();
                            }}
                          >
                            <button
                              ref={slideMenuButtonRef}
                              type="button"
                              className="slide-options-button"
                              aria-label={`Canvas ${index + 1} options`}
                              aria-expanded={openSlideMenuId === slide.id}
                              aria-controls={
                                openSlideMenuId === slide.id
                                  ? `slide-menu-${slide.id}`
                                  : undefined
                              }
                              onClick={() =>
                                setOpenSlideMenuId((current) =>
                                  current === slide.id ? null : slide.id,
                                )
                              }
                            >
                              <MoreVertical aria-hidden="true" />
                            </button>

                            {openSlideMenuId === slide.id ? (
                              <div
                                id={`slide-menu-${slide.id}`}
                                className="slide-menu-popover"
                                role="group"
                                aria-label={`Canvas ${index + 1} actions`}
                              >
                                <button
                                  type="button"
                                  className="delete-slide-action"
                                  disabled={deck.slides.length <= 1}
                                  onClick={() => deleteSlide(slide.id)}
                                >
                                  <Trash2 aria-hidden="true" />
                                  <span>Delete canvas</span>
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="add-slide-slot">
                      <button
                        type="button"
                        className="add-slide-button"
                        aria-label={`Insert and go to a new slide after slide ${index + 1}`}
                        title={
                          deck.slides.length >= MAX_SLIDES
                            ? 'Maximum of 20 slides reached'
                            : `Insert slide after ${index + 1}`
                        }
                        disabled={deck.slides.length >= MAX_SLIDES}
                        onClick={() => insertSlideAfter(slide.id)}
                      >
                        <Plus aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            className="overview-scroll-button overview-scroll-right"
            aria-label="Scroll slide previews right"
            disabled={!overviewScrollAvailability.right}
            onClick={() => scrollSlideOverview(1)}
          >
            <ChevronRight aria-hidden="true" />
          </button>

          <button
            type="button"
            className="close-slide-overview"
            aria-label="Close slide overview"
            onClick={() => closeSlideOverview('counter')}
          >
            <ChevronUp aria-hidden="true" />
          </button>
      </section>

      <div className="commandbar" inert={isSlideOverviewOpen}>
        <div className="history-controls" aria-label="History controls">
          <button
            type="button"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            disabled={deckHistory.past.length === 0}
            onClick={undo}
          >
            <Undo2 aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            disabled={deckHistory.future.length === 0}
            onClick={redo}
          >
            <Redo2 aria-hidden="true" />
          </button>
        </div>
        <span className="command-divider" aria-hidden="true" />
        <div className="zoom-control" aria-hidden="true">
          <ZoomIn />
          <ChevronDown />
        </div>
        <span className="command-divider" aria-hidden="true" />
        <span className="command-label background-label" aria-hidden="true">
          Set background
        </span>
        <span className="command-divider" aria-hidden="true" />
        <span className="command-label clear-label" aria-hidden="true">
          Clear frame
        </span>
      </div>

      <section
        className="workspace"
        aria-label="Whiteboard workspace"
        inert={isSlideOverviewOpen}
      >
        <div
          ref={boardRef}
          className={`board${
            selectedToolId === 'sticky-note' ? ' is-placing-sticky-note' : ''
          }${selectedToolId === 'pen' ? ' is-drawing' : ''}${
            selectedToolId === 'eraser' ? ' is-erasing' : ''
          }${selectedToolId === 'shape' ? ' is-placing-shape' : ''}`}
          role="region"
          tabIndex={0}
          aria-label={
            selectedToolId === 'eraser'
              ? 'Board. Ink eraser active. Drag over ink to erase; objects are unaffected.'
              : selectedToolId === 'shape'
                ? `Board. ${getShapeOption(activeShape).label} tool active. Drag to create a shape.`
                : 'Board. Draw, add sticky notes, or paste images.'
          }
          onPointerDown={(event) => {
            if (event.currentTarget !== event.target) return;
            if (selectedToolId === 'sticky-note') {
              event.preventDefault();
              placeStickyNote(event.clientX, event.clientY);
              return;
            }
            setSelectedItemId(null);
            setOpenItemMenuId(null);
            setOpenColorPickerId(null);
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={finishGesture}
          onPointerCancel={finishGesture}
        >
          {canvasObjects.map((item) => {
            const isPendingStickyNote =
              pendingStickyNote?.note.id === item.id;
            const isCreatingShape = pendingShape?.shape.id === item.id;
            const isPending = isPendingStickyNote || isCreatingShape;
            const isDiscarding =
              isPendingStickyNote && pendingStickyNote?.discarding === true;
            const isSelected = selectedItemId === item.id;
            const isMenuOpen = openItemMenuId === item.id;
            const isColorPickerOpen = openColorPickerId === item.id;
            const isRemovingBackground =
              item.kind === 'image' &&
              backgroundRemovalJobKeys.has(
                backgroundRemovalJobKey(deck.activeSlideId, item.id),
              );
            const itemLabel =
              item.kind === 'image'
                ? 'image'
                : item.kind === 'sticky-note'
                  ? 'sticky note'
                  : 'shape';
            const itemExtents = rotatedItemExtents(item);
            const colorPickerPosition = [
              item.x - itemExtents.horizontal < BOARD_WIDTH * 0.35
                ? ' opens-right'
                : '',
              item.x + itemExtents.horizontal > BOARD_WIDTH - 96
                ? ' is-contained-right'
                : '',
              item.y + itemExtents.vertical > BOARD_HEIGHT - 96
                ? ' is-contained-bottom'
                : '',
            ].join('');
            const frameStyle = {
              transform: `rotate(${item.rotation}deg)`,
              '--counter-rotation': `${-item.rotation}deg`,
            } as CSSProperties;

            return (
              <div
                key={item.id}
                className={`canvas-item${isSelected ? ' is-selected' : ''}${
                  isDiscarding ? ' is-discarding' : ''
                }${isCreatingShape ? ' is-creating-shape' : ''}`}
                style={{
                  left: `${(item.x / BOARD_WIDTH) * 100}%`,
                  top: `${(item.y / BOARD_HEIGHT) * 100}%`,
                  width: `${(item.width / BOARD_WIDTH) * 100}%`,
                  height: `${(item.height / BOARD_HEIGHT) * 100}%`,
                  zIndex: isSelected
                    ? items.length + 2
                    : itemLayer.get(item.id),
                }}
                data-item-id={item.id}
                data-item-type={item.kind}
                data-shape-type={
                  item.kind === 'shape' ? item.shape : undefined
                }
                data-shape-color={
                  item.kind === 'shape' ? item.color : undefined
                }
                data-arrow-direction={
                  item.kind === 'shape' && item.shape === 'arrow'
                    ? (item.arrowDirection ?? 'right')
                    : undefined
                }
              >
                <div
                  ref={(element) => {
                    if (element) itemFrameRefsRef.current.set(item.id, element);
                    else itemFrameRefsRef.current.delete(item.id);
                  }}
                  className={`canvas-item-frame${isSelected ? ' is-selected' : ''}`}
                  style={frameStyle}
                  role="group"
                  tabIndex={0}
                  aria-busy={isRemovingBackground || undefined}
                  aria-label={
                    item.kind === 'image'
                      ? item.name
                      : item.kind === 'sticky-note'
                        ? `Sticky note: ${item.text.trim() || 'Blank'}`
                        : `${getShapeOption(item.shape).label} shape`
                  }
                  onDoubleClick={(event) => {
                    if (item.kind !== 'sticky-note') return;
                    event.preventDefault();
                    event.stopPropagation();
                    beginStickyNoteEdit(item);
                  }}
                  onFocus={(event) => {
                    if (event.currentTarget !== event.target) return;
                    setSelectedItemId(item.id);
                    setOpenItemMenuId(null);
                    setOpenColorPickerId(null);
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.currentTarget !== event.target ||
                      isPending ||
                      item.kind !== 'sticky-note' ||
                      (event.key !== 'Enter' && event.key !== 'F2')
                    ) {
                      return;
                    }
                    event.preventDefault();
                    beginStickyNoteEdit(item);
                  }}
                  onPointerDown={(event) => {
                    if (isPending) {
                      event.preventDefault();
                      event.stopPropagation();
                      return;
                    }
                    startGesture(event, item, 'move');
                  }}
                >
                  {item.kind === 'image' ? (
                    <img
                      className="canvas-image"
                      src={activeImageSource(item)}
                      alt={item.name}
                      draggable={false}
                    />
                  ) : item.kind === 'sticky-note' ? (
                    <StickyNoteContent
                      note={item}
                      draft={
                        stickyNoteEdit?.itemId === item.id
                          ? stickyNoteEdit.draft
                          : undefined
                      }
                      onDraftChange={(draft) =>
                        setStickyNoteEdit((current) =>
                          current?.itemId === item.id
                            ? { ...current, draft }
                            : current,
                        )
                      }
                      onFinishEditing={finishStickyNoteEdit}
                    />
                  ) : (
                    <ShapeContent
                      arrowDirection={item.arrowDirection}
                      color={item.color}
                      filled={item.filled}
                      shape={item.shape}
                      />
                    )}

                  {isRemovingBackground ? (
                    <span
                      className="background-removal-indicator"
                      aria-hidden="true"
                    >
                      <span />
                    </span>
                  ) : null}

                  {isSelected ? (
                    <>
                      <span className="selection-outline" aria-hidden="true" />
                      {!isPending ? (
                        <>
                          <button
                            type="button"
                            className="rotation-zone"
                            aria-label={`Rotate ${itemLabel}`}
                            title={`Drag around the ${itemLabel} to rotate. Hold Shift to snap.`}
                            onPointerDown={(event) =>
                              startGesture(event, item, 'rotate')
                            }
                          />

                          {resizeCorners.map((corner) => (
                            <button
                              key={corner}
                              type="button"
                              className={`resize-handle resize-${corner}`}
                              aria-label={`Resize ${itemLabel} from ${corner.toUpperCase()} corner`}
                              title="Drag to resize"
                              onPointerDown={(event) =>
                                startGesture(event, item, 'resize', corner)
                              }
                            />
                          ))}
                        </>
                      ) : null}

                      {item.kind === 'sticky-note' ? (
                        <div
                          className={`note-color-anchor${
                            isColorPickerOpen ? ' is-open' : ''
                          }${colorPickerPosition}`}
                          data-color-picker={item.id}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onDoubleClick={(event) => event.stopPropagation()}
                        >
                          {isColorPickerOpen ? (
                            <div
                              className="note-color-options"
                              role="radiogroup"
                              aria-label="Sticky note color"
                            >
                              {stickyNoteColors.map((color) => (
                                <button
                                  key={color.id}
                                  ref={
                                    item.color === color.id
                                      ? activeColorChoiceRef
                                      : undefined
                                  }
                                  type="button"
                                  className={`note-color-choice${
                                    color.id === 'transparent'
                                      ? ' is-no-fill'
                                      : ''
                                  }`}
                                  role="radio"
                                  aria-label={color.label}
                                  aria-checked={item.color === color.id}
                                  tabIndex={item.color === color.id ? 0 : -1}
                                  title={color.label}
                                  style={
                                    {
                                      '--note-swatch-color': color.value,
                                    } as CSSProperties
                                  }
                                  onClick={() =>
                                    changeStickyNoteColor(item.id, color.id)
                                  }
                                  onKeyDown={(event) => {
                                    if (
                                      event.key === 'Enter' ||
                                      event.key === ' '
                                    ) {
                                      event.preventDefault();
                                      changeStickyNoteColor(item.id, color.id);
                                      return;
                                    }
                                    moveColorChoiceFocus(event);
                                  }}
                                >
                                  <span aria-hidden="true" />
                                </button>
                              ))}
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="note-color-trigger"
                              aria-label="Change sticky note color"
                              aria-expanded={false}
                              title="Change color"
                              onKeyDown={(event) => {
                                if (
                                  event.key !== 'Enter' &&
                                  event.key !== ' '
                                ) {
                                  return;
                                }
                                event.preventDefault();
                                focusColorPickerOnOpenRef.current = true;
                                setOpenColorPickerId(item.id);
                              }}
                              onClick={(event) => {
                                focusColorPickerOnOpenRef.current =
                                  event.detail === 0;
                                setOpenColorPickerId(item.id);
                              }}
                            >
                              <span
                                className={
                                  item.color === 'transparent'
                                    ? 'is-no-fill'
                                    : undefined
                                }
                                style={{
                                  backgroundColor: getStickyNoteColorValue(
                                    item.color,
                                  ),
                                }}
                                aria-hidden="true"
                              />
                            </button>
                          )}
                        </div>
                      ) : item.kind === 'shape' ? (
                        <div
                          className={`note-color-anchor${
                            isColorPickerOpen ? ' is-open' : ''
                          }${colorPickerPosition}`}
                          data-color-picker={item.id}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                        >
                          {isColorPickerOpen ? (
                            <div
                              className="note-color-options"
                              role="radiogroup"
                              aria-label="Shape color"
                            >
                              {shapeColors.map((color) => (
                                <button
                                  key={color.id}
                                  ref={
                                    item.color === color.id
                                      ? activeColorChoiceRef
                                      : undefined
                                  }
                                  type="button"
                                  className="note-color-choice shape-color-choice"
                                  role="radio"
                                  aria-label={color.label}
                                  aria-checked={item.color === color.id}
                                  tabIndex={item.color === color.id ? 0 : -1}
                                  title={color.label}
                                  style={
                                    {
                                      '--note-swatch-color': color.fill,
                                      '--shape-swatch-stroke':
                                        color.id === 'white'
                                          ? '#bdc1c6'
                                          : color.stroke,
                                    } as CSSProperties
                                  }
                                  onClick={() =>
                                    changeShapeColor(item.id, color.id)
                                  }
                                  onKeyDown={(event) => {
                                    if (
                                      event.key === 'Enter' ||
                                      event.key === ' '
                                    ) {
                                      event.preventDefault();
                                      changeShapeColor(item.id, color.id);
                                      return;
                                    }
                                    moveColorChoiceFocus(event);
                                  }}
                                >
                                  <span aria-hidden="true" />
                                </button>
                              ))}
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="note-color-trigger shape-color-trigger"
                              aria-label="Change shape color"
                              aria-expanded={false}
                              title="Change color"
                              onKeyDown={(event) => {
                                if (
                                  event.key !== 'Enter' &&
                                  event.key !== ' '
                                ) {
                                  return;
                                }
                                event.preventDefault();
                                focusColorPickerOnOpenRef.current = true;
                                setOpenColorPickerId(item.id);
                              }}
                              onClick={(event) => {
                                focusColorPickerOnOpenRef.current =
                                  event.detail === 0;
                                setOpenColorPickerId(item.id);
                              }}
                            >
                              <span
                                className={
                                  item.filled === false
                                    ? 'is-no-fill'
                                    : undefined
                                }
                                style={{
                                  backgroundColor: getShapeColorValue(
                                    item.color,
                                  ).fill,
                                  boxShadow: `inset 0 0 0 2px ${
                                    item.color === 'white'
                                      ? '#bdc1c6'
                                      : getShapeColorValue(item.color).stroke
                                  }`,
                                }}
                                aria-hidden="true"
                              />
                            </button>
                          )}
                        </div>
                      ) : null}

                      {!isPending ? (
                        <div
                          className="item-menu-anchor"
                          data-item-menu={item.id}
                          onPointerDown={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onBlur={(event) => {
                            const nextFocused = event.relatedTarget;
                            if (
                              nextFocused instanceof Node &&
                              event.currentTarget.contains(nextFocused)
                            ) {
                              return;
                            }
                            setOpenItemMenuId((current) =>
                              current === item.id ? null : current,
                            );
                          }}
                        >
                          <button
                            ref={(element) => {
                              if (element) {
                                itemMenuButtonRefsRef.current.set(
                                  item.id,
                                  element,
                                );
                              } else {
                                itemMenuButtonRefsRef.current.delete(item.id);
                              }
                            }}
                            type="button"
                            className="item-menu-button"
                            aria-label={`${itemLabel} options`}
                            aria-expanded={isMenuOpen}
                            aria-haspopup="menu"
                            aria-controls={
                              isMenuOpen ? `item-menu-${item.id}` : undefined
                            }
                            onClick={(event) => {
                              const opening = openItemMenuId !== item.id;
                              focusItemMenuOnOpenRef.current =
                                opening && event.detail === 0;
                              setOpenItemMenuId((current) =>
                                current === item.id ? null : item.id,
                              );
                            }}
                          >
                            <MoreVertical aria-hidden="true" />
                          </button>

                          {isMenuOpen ? (
                            <div
                            id={`item-menu-${item.id}`}
                            className="item-menu-popover"
                            role="menu"
                            aria-label={`${itemLabel} options`}
                            onFocus={(event) => {
                              if (event.target instanceof HTMLButtonElement) {
                                setItemMenuTabStop(
                                  event.currentTarget,
                                  event.target,
                                );
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Tab') {
                                setOpenItemMenuId(null);
                                if (event.shiftKey) {
                                  event.preventDefault();
                                  itemMenuButtonRefsRef.current
                                    .get(item.id)
                                    ?.focus({ preventScroll: true });
                                }
                                return;
                              }
                              moveItemMenuFocus(event);
                            }}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              tabIndex={0}
                              onClick={() => duplicateItem(item)}
                            >
                              <CopyPlus aria-hidden="true" />
                              Duplicate {itemLabel}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              tabIndex={-1}
                              onClick={() => copyItem(item)}
                            >
                              <Copy aria-hidden="true" />
                              Copy {itemLabel}
                            </button>
                            {item.kind === 'shape' ? (
                              <button
                                type="button"
                                role="menuitem"
                                tabIndex={-1}
                                onClick={() => toggleShapeFill(item.id)}
                              >
                                <PaintBucket aria-hidden="true" />
                                {item.filled === false
                                  ? 'Add fill'
                                  : 'Remove fill'}
                              </button>
                            ) : null}
                            {item.kind === 'image' &&
                            BACKGROUND_REMOVAL_ENABLED ? (
                              <button
                                type="button"
                                role="menuitem"
                                tabIndex={-1}
                                disabled={isRemovingBackground}
                                onClick={() => toggleImageBackground(item)}
                              >
                                <ImageOff aria-hidden="true" />
                                {isRemovingBackground
                                  ? 'Removing background…'
                                  : item.backgroundRemoved === true &&
                                      item.backgroundRemovedSrc
                                    ? 'Restore background'
                                    : 'Remove background'}
                              </button>
                            ) : null}
                            <span className="item-menu-divider" aria-hidden="true" />
                            <button
                              type="button"
                              role="menuitem"
                              tabIndex={-1}
                              onClick={() => rotateItem(item.id, -15)}
                            >
                              <RotateCcw aria-hidden="true" />
                              Rotate left
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              tabIndex={-1}
                              onClick={() => rotateItem(item.id, 15)}
                            >
                              <RotateCw aria-hidden="true" />
                              Rotate right
                            </button>
                            <span className="item-menu-divider" aria-hidden="true" />
                            <button
                              type="button"
                              role="menuitem"
                              tabIndex={-1}
                              className="delete-item-action"
                              onClick={() => deleteItem(item.id)}
                            >
                              <Trash2 aria-hidden="true" />
                              Delete {itemLabel}
                            </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}

          {inkRuns.map((run) => (
            <svg
              key={run.id}
              className="completed-ink-layer"
              viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
              preserveAspectRatio="none"
              aria-hidden="true"
              style={{ zIndex: run.layer }}
            >
              {run.strokes.map((stroke) => (
                <InkStrokePath key={stroke.id} stroke={stroke} />
              ))}
            </svg>
          ))}

          {selectedToolId === 'pen' ||
          selectedToolId === 'eraser' ||
          selectedToolId === 'shape' ? (
            <div
              ref={drawingSurfaceRef}
              className={`drawing-surface${
                selectedToolId === 'eraser' ? ' is-erasing' : ''
              }${selectedToolId === 'shape' ? ' is-shaping' : ''}`}
              aria-hidden="true"
              onPointerDown={
                selectedToolId === 'pen'
                  ? startInkStroke
                  : selectedToolId === 'eraser'
                    ? startEraserStroke
                    : startShapeCreation
              }
              onPointerMove={
                selectedToolId === 'pen'
                  ? moveInkStroke
                  : selectedToolId === 'eraser'
                    ? moveEraserStroke
                    : updateShapeCreation
              }
              onPointerUp={
                selectedToolId === 'pen'
                  ? finishInkStroke
                  : selectedToolId === 'eraser'
                    ? finishEraserStroke
                    : finishShapeCreation
              }
              onPointerCancel={
                selectedToolId === 'pen'
                  ? cancelInkStroke
                  : selectedToolId === 'eraser'
                    ? cancelEraserStroke
                    : cancelShapeCreation
              }
              onLostPointerCapture={
                selectedToolId === 'pen'
                  ? cancelInkStroke
                  : selectedToolId === 'eraser'
                    ? cancelEraserStroke
                    : cancelShapeCreation
              }
              onPointerEnter={
                selectedToolId === 'eraser' ? showEraserPreview : undefined
              }
              onPointerLeave={() => {
                if (!eraserGestureRef.current) setEraserPreview(null);
              }}
            >
              <svg
                viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
                preserveAspectRatio="none"
              >
                {selectedToolId === 'pen' && pendingStroke ? (
                  <InkStrokePath
                    ref={activeInkRendererRef}
                    live
                    stroke={pendingStroke}
                  />
                ) : null}
              </svg>
              {selectedToolId === 'eraser' && eraserPreview ? (
                <span
                  className="eraser-cursor"
                  style={{
                    left: `${(eraserPreview.x / BOARD_WIDTH) * 100}%`,
                    top: `${(eraserPreview.y / BOARD_HEIGHT) * 100}%`,
                    width: `${((eraserPreview.radius * 2) / BOARD_WIDTH) * 100}%`,
                    height: `${((eraserPreview.radius * 2) / BOARD_HEIGHT) * 100}%`,
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {notice ? (
            <div className="board-notice" role="status" aria-live="polite">
              {notice}
            </div>
          ) : null}
        </div>
      </section>

      <nav
        className="tool-palette"
        aria-label="Board tools"
        inert={isSlideOverviewOpen}
      >
        {tools.map((tool) => {
          if (tool.id === 'pen') {
            return (
              <div
                key={tool.id}
                className="drawing-menu-anchor"
                data-drawing-menu
              >
                <ToolButton
                  buttonRef={penToolButtonRef}
                  controls="drawing-options"
                  expanded={isDrawingMenuOpen}
                  tool={tool}
                  selected={selectedToolId === tool.id}
                  onSelect={() => selectTool(tool)}
                />
                {isDrawingMenuOpen ? (
                  <DrawingMenu
                    style={drawingStyle}
                    color={drawingColor}
                    onStyleChange={setDrawingStyle}
                    onColorChange={setDrawingColor}
                  />
                ) : null}
              </div>
            );
          }

          if (tool.id === 'shape') {
            return (
              <div
                key={tool.id}
                className="shape-menu-anchor"
                data-shape-menu
              >
                <ToolButton
                  buttonRef={shapeToolButtonRef}
                  controls="shape-options"
                  expanded={isShapeMenuOpen}
                  glyph={<ShapeContent icon shape={activeShape} />}
                  tool={tool}
                  selected={selectedToolId === tool.id}
                  onSelect={(event) => {
                    setFocusShapeMenuSelection(event.detail === 0);
                    selectTool(tool);
                  }}
                />
                {isShapeMenuOpen ? (
                  <ShapeMenu
                    focusSelected={focusShapeMenuSelection}
                    shape={activeShape}
                    onShapeFocus={setActiveShape}
                    onShapeSelect={chooseShape}
                  />
                ) : null}
              </div>
            );
          }

          return (
            <ToolButton
              key={tool.id}
              tool={tool}
              selected={selectedToolId === tool.id}
              onSelect={() => selectTool(tool)}
            />
          );
        })}
      </nav>
    </main>
  );
}
