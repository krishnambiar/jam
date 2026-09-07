'use client';

import {
  Brush,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Eraser,
  MoreVertical,
  MousePointer2,
  Pen,
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
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const BOARD_WIDTH = 1600;
const BOARD_HEIGHT = 900;
const MIN_IMAGE_SIZE = 56;
const HISTORY_LIMIT = 100;

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
  imageId: string;
  before: CanvasImage[];
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
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: [],
    future: [],
  });
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);

  const commit = useCallback(
    (update: (images: CanvasImage[]) => CanvasImage[]) => {
      setHistory((current) => {
        const next = update(current.present);
        if (next === current.present) return current;

        return {
          past: addToPast(current.past, current.present),
          present: next,
          future: [],
        };
      });
    },
    [],
  );

  const undo = useCallback(() => {
    setOpenMenuId(null);
    setSelectedImageId(null);
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;

      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future].slice(0, HISTORY_LIMIT),
      };
    });
  }, []);

  const redo = useCallback(() => {
    setOpenMenuId(null);
    setSelectedImageId(null);
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;

      return {
        past: addToPast(current.past, current.present),
        present: next,
        future: current.future.slice(1),
      };
    });
  }, []);

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

  const pasteImages = useCallback(async (files: File[]) => {
    const results = await Promise.allSettled(files.map(decodeImageFile));
    const decoded = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );

    if (decoded.length === 0) {
      setNotice('That image format is not supported by this browser.');
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

    setHistory((current) => {
      const positioned = additions.map((image, index) => {
        const offset = ((current.present.length + index) % 5) * 22;
        return {
          ...image,
          x: clamp(image.x + offset, image.width / 2, BOARD_WIDTH - image.width / 2),
          y: clamp(image.y + offset, image.height / 2, BOARD_HEIGHT - image.height / 2),
        };
      });

      return {
        past: addToPast(current.past, current.present),
        present: [...current.present, ...positioned],
        future: [],
      };
    });
    setSelectedImageId(additions.at(-1)?.id ?? null);
    setOpenMenuId(null);
    setNotice(
      additions.length === 1
        ? 'Image pasted. Drag to move it and use the blue corners to resize.'
        : `${additions.length} images pasted.`,
    );
  }, []);

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

      if (event.key === 'Escape') {
        setOpenMenuId(null);
        setSelectedImageId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteImage, redo, selectedImageId, undo]);

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
      imageId: image.id,
      before: history.present,
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
    setHistory((current) => ({
      ...current,
      present: current.present.map((currentImage) =>
        currentImage.id === gesture.imageId ? nextImage : currentImage,
      ),
    }));
  };

  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    gestureRef.current = null;
    if (!gesture.moved) return;

    setHistory((current) => ({
      past: addToPast(current.past, gesture.before),
      present: current.present.map((image) =>
        image.id === gesture.imageId
          ? { ...image, rotation: normalizeRotation(image.rotation) }
          : image,
      ),
      future: [],
    }));
  };

  const images = history.present;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="document-title">Untitled Jam</div>

        <div className="frame-navigation" aria-hidden="true">
          <ChevronLeft className="previous-frame" />
          <div className="frame-counter">
            <span>1/20</span>
          </div>
          <ChevronRight className="next-frame" />
        </div>

        <div className="top-actions" aria-hidden="true">
          <div className="account-control">
            <UserRound />
          </div>
        </div>
      </header>

      <div className="commandbar">
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

      <section className="workspace" aria-label="Whiteboard workspace">
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

      <nav className="tool-palette" aria-label="Board tools">
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
