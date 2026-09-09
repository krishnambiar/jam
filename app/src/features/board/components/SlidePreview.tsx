import { BOARD_HEIGHT, BOARD_WIDTH } from '../constants';
import type { CanvasItem } from '../types';
import { InkStrokePath } from './InkStroke';
import { StickyNoteContent } from './StickyNoteContent';

type SlidePreviewProps = {
  items: CanvasItem[];
};

export function SlidePreview({ items }: SlidePreviewProps) {
  const strokes = items.filter((item) => item.kind === 'stroke');
  const objects = items.filter((item) => item.kind !== 'stroke');

  return (
    <span className="slide-preview-canvas" aria-hidden="true">
      {objects.map((item) => (
        <span
          key={item.id}
          className="slide-preview-item"
          style={{
            left: `${(item.x / BOARD_WIDTH) * 100}%`,
            top: `${(item.y / BOARD_HEIGHT) * 100}%`,
            width: `${(item.width / BOARD_WIDTH) * 100}%`,
            height: `${(item.height / BOARD_HEIGHT) * 100}%`,
            transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`,
          }}
        >
          {item.kind === 'image' ? (
            <img src={item.src} alt="" draggable={false} />
          ) : (
            <StickyNoteContent note={item} />
          )}
        </span>
      ))}
      {strokes.length > 0 ? (
        <svg
          className="slide-preview-ink"
          viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
          preserveAspectRatio="none"
        >
          {strokes.map((stroke) => (
            <InkStrokePath key={stroke.id} stroke={stroke} />
          ))}
        </svg>
      ) : null}
    </span>
  );
}
