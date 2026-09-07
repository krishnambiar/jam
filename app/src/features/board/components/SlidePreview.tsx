import { BOARD_HEIGHT, BOARD_WIDTH } from '../constants';
import type { CanvasItem } from '../types';
import { StickyNoteContent } from './StickyNoteContent';

type SlidePreviewProps = {
  items: CanvasItem[];
};

export function SlidePreview({ items }: SlidePreviewProps) {
  return (
    <span className="slide-preview-canvas" aria-hidden="true">
      {items.map((item) => (
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
    </span>
  );
}
