'use client';

import {
  Brush,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Eraser,
  MoreVertical,
  MousePointer2,
  Pen,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  ScanText,
  Trash2,
  Undo2,
  UserRound,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const BOARD_WIDTH = 1600;
const BOARD_HEIGHT = 900;
const MIN_IMAGE_SIZE = 56;
const HISTORY_LIMIT = 100;
const MAX_SLIDES = 20;
const INITIAL_SLIDE_ID = 'slide-1';

type Tool = {
  label: string;
  icon: LucideIcon | null;
  menu?: boolean;
};

type CanvasImage = {
  id: string;
  src: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

type HistoryState = {
  past: CanvasImage[][];
  present: CanvasImage[];
  future: CanvasImage[][];
};

type Slide = {
  id: string;
  history: HistoryState;
};

type SlideDeck = {
  slides: Slide[];
  activeSlideId: string;
};

type BoardRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type Point = { x: number; y: number };
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

type Gesture = {
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

const tools: Tool[] = [
  { label: 'Pen', icon: Pen, menu: true },
  { label: 'Eraser', icon: Eraser },
  { label: 'Select', icon: MousePointer2 },
  { label: 'Sticky note', icon: null },
  { label: 'Shape', icon: Circle, menu: true },
  { label: 'Text box', icon: ScanText },
  { label: 'Laser pointer', icon: Brush },
];

const resizeCorners: ResizeCorner[] = ['nw', 'ne', 'sw', 'se'];

const EMPTY_HISTORY: HistoryState = {
  past: [],
  present: [],
  future: [],
};

function createEmptySlide(id: string): Slide {
  return {
    id,
    history: {
      past: [],
      present: [],
      future: [],
    },
  };
}

function ToolButton({
  tool,
  selected,
  onSelect,
}: {
  tool: Tool;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = tool.icon;

  return (
    <button
      type="button"
      className={`tool-button${selected ? ' is-selected' : ''}`}
      aria-label={tool.label}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {Icon ? (
        <Icon aria-hidden="true" strokeWidth={selected ? 2.35 : 2.2} />
      ) : (
        <span className="sticky-note-glyph" aria-hidden="true">
          <span className="sticky-note-lines" />
        </span>
      )}
      {tool.menu ? (
        <ChevronRight className="tool-menu-mark" aria-hidden="true" />
      ) : null}
    </button>
  );
}

function SlidePreview({ images }: { images: CanvasImage[] }) {
  return (
    <span className="slide-preview-canvas" aria-hidden="true">
      {images.map((image) => (
        <span
          key={image.id}
          className="slide-preview-item"
          style={{
            left: `${(image.x / BOARD_WIDTH) * 100}%`,
            top: `${(image.y / BOARD_HEIGHT) * 100}%`,
            width: `${(image.width / BOARD_WIDTH) * 100}%`,
            height: `${(image.height / BOARD_HEIGHT) * 100}%`,
            transform: `translate(-50%, -50%) rotate(${image.rotation}deg)`,
          }}
        >
          {/* Clipboard images use local data URLs and cannot use an image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.src} alt="" draggable={false} />
        </span>
      ))}
    </span>
  );
}

function addToPast(past: CanvasImage[][], snapshot: CanvasImage[]) {
  return [...past, snapshot].slice(-HISTORY_LIMIT);
}

function boardPoint(clientX: number, clientY: number, rect: BoardRect): Point {
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

function clamp(value: number, minimum: number, maximum: number) {
  if (maximum < minimum) return (minimum + maximum) / 2;
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizeRotation(degrees: number) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

function resizedImage(
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

function fittedImageSize(naturalWidth: number, naturalHeight: number) {
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

function isTextEntry(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function decodeImageFile(file: File) {
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

export default function Home() {
  const [selectedTool, setSelectedTool] = useState(2);
  const [deck, setDeck] = useState<SlideDeck>(() => ({
    slides: [createEmptySlide(INITIAL_SLIDE_ID)],
    activeSlideId: INITIAL_SLIDE_ID,
  }));
  const [isSlideOverviewOpen, setIsSlideOverviewOpen] = useState(false);
  const [overviewScrollAvailability, setOverviewScrollAvailability] = useState({
    left: false,
    right: false,
  });
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const overviewViewportRef = useRef<HTMLDivElement>(null);
  const activeThumbnailRef = useRef<HTMLButtonElement>(null);
  const frameCounterRef = useRef<HTMLButtonElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const activeSlideIdRef = useRef(deck.activeSlideId);
  const wasSlideOverviewOpenRef = useRef(false);

  useLayoutEffect(() => {
    activeSlideIdRef.current = deck.activeSlideId;
  }, [deck.activeSlideId]);

  const activeSlideIndex = Math.max(
    0,
    deck.slides.findIndex((slide) => slide.id === deck.activeSlideId),
  );
  const activeSlide = deck.slides[activeSlideIndex];
  const history = activeSlide?.history ?? EMPTY_HISTORY;

  const updateActiveHistory = useCallback(
    (update: (history: HistoryState) => HistoryState) => {
      setDeck((current) => {
        let changed = false;
        const slides = current.slides.map((slide) => {
          if (slide.id !== current.activeSlideId) return slide;
          const nextHistory = update(slide.history);
          if (nextHistory === slide.history) return slide;
          changed = true;
          return { ...slide, history: nextHistory };
        });

        return changed ? { ...current, slides } : current;
      });
    },
    [],
  );

  const cancelActiveGesture = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture?.moved) return;

    setDeck((current) => ({
      ...current,
      slides: current.slides.map((slide) =>
        slide.id === gesture.slideId
          ? {
              ...slide,
              history: {
                ...slide.history,
                present: slide.history.present.map((image) =>
                  image.id === gesture.imageId ? gesture.initialImage : image,
                ),
              },
            }
          : slide,
      ),
    }));
  }, []);

  const commit = useCallback(
    (update: (images: CanvasImage[]) => CanvasImage[]) => {
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
    cancelActiveGesture();
    setOpenMenuId(null);
    setSelectedImageId(null);
    updateActiveHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;

      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future].slice(0, HISTORY_LIMIT),
      };
    });
  }, [cancelActiveGesture, updateActiveHistory]);

  const redo = useCallback(() => {
    cancelActiveGesture();
    setOpenMenuId(null);
    setSelectedImageId(null);
    updateActiveHistory((current) => {
      const next = current.future[0];
      if (!next) return current;

      return {
        past: addToPast(current.past, current.present),
        present: next,
        future: current.future.slice(1),
      };
    });
  }, [cancelActiveGesture, updateActiveHistory]);

  const deleteImage = useCallback(
    (imageId: string) => {
      commit((images) => {
        if (!images.some((image) => image.id === imageId)) return images;
        return images.filter((image) => image.id !== imageId);
      });
      setSelectedImageId((current) => (current === imageId ? null : current));
      setOpenMenuId(null);
    },
    [commit],
  );

  const rotateImage = useCallback(
    (imageId: string, degrees: number) => {
      commit((images) =>
        images.map((image) =>
          image.id === imageId
            ? { ...image, rotation: normalizeRotation(image.rotation + degrees) }
            : image,
        ),
      );
      setOpenMenuId(null);
    },
    [commit],
  );

  const pasteImages = useCallback(
    async (files: File[]) => {
      const targetSlideId = activeSlideIdRef.current;
      cancelActiveGesture();
      setSelectedImageId(null);
      setOpenMenuId(null);
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
              imageId: gestureAtCompletion.imageId,
              initialImage: gestureAtCompletion.initialImage,
            }
          : null;

      setDeck((current) => {
        let changed = false;
        const slides = current.slides.map((slide) => {
          if (slide.id !== targetSlideId) return slide;
          changed = true;
          const positioned = additions.map((image, index) => {
            const offset = ((slide.history.present.length + index) % 5) * 22;
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

          return {
            ...slide,
            history: {
              past: addToPast(
                slide.history.past,
                concurrentGesture
                  ? slide.history.present.map((currentImage) =>
                      currentImage.id === concurrentGesture.imageId
                        ? concurrentGesture.initialImage
                        : currentImage,
                    )
                  : slide.history.present,
              ),
              present: [...slide.history.present, ...positioned],
              future: [],
            },
          };
        });

        return changed ? { ...current, slides } : current;
      });
      if (activeSlideIdRef.current === targetSlideId) {
        setSelectedImageId(
          concurrentGesture?.imageId ?? additions.at(-1)?.id ?? null,
        );
        setOpenMenuId(null);
        setNotice(
          additions.length === 1
            ? 'Image pasted. Drag to move it and use the blue corners to resize.'
            : `${additions.length} images pasted.`,
        );
      }
    },
    [cancelActiveGesture],
  );

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (isTextEntry(event.target)) return;

      const itemFiles = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      const files =
        itemFiles.length > 0
          ? itemFiles
          : Array.from(event.clipboardData?.files ?? []);

      if (files.length === 0) return;
      event.preventDefault();
      void pasteImages(files);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [pasteImages]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) return;

      if (event.key === 'Escape') {
        setIsSlideOverviewOpen(false);
        setOpenMenuId(null);
        setSelectedImageId(null);
        return;
      }

      if (isSlideOverviewOpen) return;

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

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedImageId) {
        event.preventDefault();
        deleteImage(selectedImageId);
        return;
      }

    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteImage, isSlideOverviewOpen, redo, selectedImageId, undo]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!openMenuId) return;

    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(`[data-item-menu="${openMenuId}"]`)) return;
      setOpenMenuId(null);
    };

    document.addEventListener('pointerdown', closeMenu, true);
    return () => document.removeEventListener('pointerdown', closeMenu, true);
  }, [openMenuId]);

  const startGesture = (
    event: ReactPointerEvent<HTMLElement>,
    image: CanvasImage,
    kind: Gesture['kind'],
    corner?: ResizeCorner,
  ) => {
    if (event.button !== 0 || !boardRef.current) return;

    event.preventDefault();
    event.stopPropagation();
    const rect = boardRef.current.getBoundingClientRect();
    const compactRect: BoardRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    const startPoint = boardPoint(event.clientX, event.clientY, compactRect);

    gestureRef.current = {
      kind,
      pointerId: event.pointerId,
      slideId: deck.activeSlideId,
      imageId: image.id,
      initialImage: image,
      boardRect: compactRect,
      startPoint,
      startAngle:
        kind === 'rotate'
          ? Math.atan2(startPoint.y - image.y, startPoint.x - image.x) *
            (180 / Math.PI)
          : undefined,
      corner,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedImageId(image.id);
    setOpenMenuId(null);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    event.preventDefault();
    const point = boardPoint(event.clientX, event.clientY, gesture.boardRect);
    const image = gesture.initialImage;
    let nextImage = image;

    if (gesture.kind === 'move') {
      const deltaX = point.x - gesture.startPoint.x;
      const deltaY = point.y - gesture.startPoint.y;
      const radians = (image.rotation * Math.PI) / 180;
      const horizontalExtent =
        (Math.abs(Math.cos(radians)) * image.width +
          Math.abs(Math.sin(radians)) * image.height) /
        2;
      const verticalExtent =
        (Math.abs(Math.sin(radians)) * image.width +
          Math.abs(Math.cos(radians)) * image.height) /
        2;

      nextImage = {
        ...image,
        x: clamp(image.x + deltaX, horizontalExtent, BOARD_WIDTH - horizontalExtent),
        y: clamp(image.y + deltaY, verticalExtent, BOARD_HEIGHT - verticalExtent),
      };
    } else if (gesture.kind === 'resize' && gesture.corner) {
      nextImage = resizedImage(image, gesture.corner, point);
    } else if (gesture.kind === 'rotate' && gesture.startAngle !== undefined) {
      const pointerAngle =
        Math.atan2(point.y - image.y, point.x - image.x) * (180 / Math.PI);
      let rotation = image.rotation + pointerAngle - gesture.startAngle;
      if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
      nextImage = { ...image, rotation };
    }

    const changed =
      Math.abs(nextImage.x - image.x) > 0.01 ||
      Math.abs(nextImage.y - image.y) > 0.01 ||
      Math.abs(nextImage.width - image.width) > 0.01 ||
      Math.abs(nextImage.height - image.height) > 0.01 ||
      Math.abs(nextImage.rotation - image.rotation) > 0.01;

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
                  present: slide.history.present.map((currentImage) =>
                    currentImage.id === gesture.imageId ? nextImage : currentImage,
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
    if (!gesture.moved) return;

    setDeck((current) => {
      if (current.activeSlideId !== gesture.slideId) return current;

      return {
        ...current,
        slides: current.slides.map((slide) =>
          slide.id === gesture.slideId
            ? {
                ...slide,
                history: {
                  past: addToPast(
                    slide.history.past,
                    slide.history.present.map((image) =>
                      image.id === gesture.imageId ? gesture.initialImage : image,
                    ),
                  ),
                  present: slide.history.present.map((image) =>
                    image.id === gesture.imageId
                      ? { ...image, rotation: normalizeRotation(image.rotation) }
                      : image,
                  ),
                  future: [],
                },
              }
            : slide,
        ),
      };
    });
  };

  const clearCanvasSelection = useCallback(() => {
    cancelActiveGesture();
    setSelectedImageId(null);
    setOpenMenuId(null);
  }, [cancelActiveGesture]);

  const selectSlide = useCallback(
    (slideId: string) => {
      clearCanvasSelection();
      setDeck((current) =>
        current.slides.some((slide) => slide.id === slideId)
          ? { ...current, activeSlideId: slideId }
          : current,
      );
    },
    [clearCanvasSelection],
  );

  const goToPreviousSlide = useCallback(() => {
    clearCanvasSelection();
    setDeck((current) => {
      const currentIndex = current.slides.findIndex(
        (slide) => slide.id === current.activeSlideId,
      );
      if (currentIndex <= 0) return current;
      return {
        ...current,
        activeSlideId: current.slides[currentIndex - 1].id,
      };
    });
  }, [clearCanvasSelection]);

  const goToNextSlide = useCallback(() => {
    const newSlideId = crypto.randomUUID();
    clearCanvasSelection();
    setDeck((current) => {
      const currentIndex = current.slides.findIndex(
        (slide) => slide.id === current.activeSlideId,
      );
      const nextSlide = current.slides[currentIndex + 1];

      if (nextSlide) {
        return { ...current, activeSlideId: nextSlide.id };
      }
      if (current.slides.length >= MAX_SLIDES) return current;

      return {
        slides: [...current.slides, createEmptySlide(newSlideId)],
        activeSlideId: newSlideId,
      };
    });
  }, [clearCanvasSelection]);

  const insertSlideAfter = useCallback(
    (slideId: string) => {
      const newSlideId = crypto.randomUUID();
      clearCanvasSelection();
      setDeck((current) => {
        if (current.slides.length >= MAX_SLIDES) return current;
        const index = current.slides.findIndex((slide) => slide.id === slideId);
        if (index < 0) return current;

        return {
          slides: [
            ...current.slides.slice(0, index + 1),
            createEmptySlide(newSlideId),
            ...current.slides.slice(index + 1),
          ],
          activeSlideId: newSlideId,
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
        behavior: 'smooth',
      });
    },
    [],
  );

  useEffect(() => {
    if (!isSlideOverviewOpen) {
      if (wasSlideOverviewOpenRef.current) {
        wasSlideOverviewOpenRef.current = false;
        frameCounterRef.current?.focus();
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

  const images = history.present;

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
              setIsSlideOverviewOpen((current) => !current);
            }}
          >
            <span>
              {activeSlideIndex + 1}/{MAX_SLIDES}
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

      {isSlideOverviewOpen ? (
        <section
          id="slide-overview"
          className="slide-overview"
          aria-label="All slides"
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
                          <SlidePreview images={slide.history.present} />
                        </button>
                        {isActive ? (
                          <span className="slide-options" aria-hidden="true">
                            <MoreVertical />
                          </span>
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
            onClick={() => setIsSlideOverviewOpen(false)}
          >
            <ChevronUp aria-hidden="true" />
          </button>
        </section>
      ) : null}

      <div className="commandbar" inert={isSlideOverviewOpen}>
        <div className="history-controls" aria-label="History controls">
          <button
            type="button"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            disabled={history.past.length === 0}
            onClick={undo}
          >
            <Undo2 aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            disabled={history.future.length === 0}
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
          className="board"
          role="region"
          tabIndex={0}
          aria-label="Board. Paste an image, then drag it to move it."
          onPointerDown={(event) => {
            if (event.currentTarget !== event.target) return;
            setSelectedImageId(null);
            setOpenMenuId(null);
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={finishGesture}
          onPointerCancel={finishGesture}
        >
          {images.map((image) => {
            const isSelected = selectedImageId === image.id;
            const isMenuOpen = openMenuId === image.id;
            const frameStyle = {
              transform: `rotate(${image.rotation}deg)`,
              '--counter-rotation': `${-image.rotation}deg`,
            } as CSSProperties;

            return (
              <div
                key={image.id}
                className={`canvas-item${isSelected ? ' is-selected' : ''}`}
                style={{
                  left: `${(image.x / BOARD_WIDTH) * 100}%`,
                  top: `${(image.y / BOARD_HEIGHT) * 100}%`,
                  width: `${(image.width / BOARD_WIDTH) * 100}%`,
                  height: `${(image.height / BOARD_HEIGHT) * 100}%`,
                }}
                data-image-id={image.id}
              >
                <div
                  className={`canvas-image-frame${isSelected ? ' is-selected' : ''}`}
                  style={frameStyle}
                  onPointerDown={(event) => startGesture(event, image, 'move')}
                >
                  {/* Clipboard images use local data URLs and cannot use an image optimizer. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="canvas-image"
                    src={image.src}
                    alt={image.name}
                    draggable={false}
                  />

                  {isSelected ? (
                    <>
                      <span className="selection-outline" aria-hidden="true" />
                      <button
                        type="button"
                        className="rotation-zone"
                        aria-label="Rotate image"
                        title="Drag around the image to rotate. Hold Shift to snap."
                        onPointerDown={(event) =>
                          startGesture(event, image, 'rotate')
                        }
                      />

                      {resizeCorners.map((corner) => (
                        <button
                          key={corner}
                          type="button"
                          className={`resize-handle resize-${corner}`}
                          aria-label={`Resize image from ${corner.toUpperCase()} corner`}
                          title="Drag to resize"
                          onPointerDown={(event) =>
                            startGesture(event, image, 'resize', corner)
                          }
                        />
                      ))}

                      <div
                        className="item-menu-anchor"
                        data-item-menu={image.id}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="item-menu-button"
                          aria-label="Image options"
                          aria-expanded={isMenuOpen}
                          aria-haspopup="menu"
                          onClick={() =>
                            setOpenMenuId((current) =>
                              current === image.id ? null : image.id,
                            )
                          }
                        >
                          <MoreVertical aria-hidden="true" />
                        </button>

                        {isMenuOpen ? (
                          <div className="item-menu-popover" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => rotateImage(image.id, -15)}
                            >
                              <RotateCcw aria-hidden="true" />
                              Rotate left
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => rotateImage(image.id, 15)}
                            >
                              <RotateCw aria-hidden="true" />
                              Rotate right
                            </button>
                            <span className="item-menu-divider" aria-hidden="true" />
                            <button
                              type="button"
                              role="menuitem"
                              className="delete-image-action"
                              onClick={() => deleteImage(image.id)}
                            >
                              <Trash2 aria-hidden="true" />
                              Delete image
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}

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
        {tools.map((tool, index) => (
          <ToolButton
            key={tool.label}
            tool={tool}
            selected={selectedTool === index}
            onSelect={() => setSelectedTool(index)}
          />
        ))}
      </nav>
    </main>
  );
}
