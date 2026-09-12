import { BOARD_HEIGHT, BOARD_WIDTH } from '../constants';
import { activeImageSource } from '../backgroundRemoval';
import type { CanvasItem } from '../types';
import { getInkRuns } from '../utils';
import { InkStrokePath } from './InkStroke';
import { ShapeContent } from './ShapeContent';
import { StickyNoteContent } from './StickyNoteContent';
import { TextBoxContent } from './TextBoxContent';

type SlidePreviewProps = {
  items: CanvasItem[];
};

export function SlidePreview({ items }: SlidePreviewProps) {
  const itemLayer = new Map(
    items.map((item, index) => [item.id, index + 1] as const),
  );
  const inkRuns = getInkRuns(items);

  return (
    <span className="slide-preview-canvas" aria-hidden="true">
      {items.map((item) =>
        item.kind === 'stroke' ? null : (
          <span
            key={item.id}
            className="slide-preview-item"
            style={{
              left: `${(item.x / BOARD_WIDTH) * 100}%`,
              top: `${(item.y / BOARD_HEIGHT) * 100}%`,
              width: `${(item.width / BOARD_WIDTH) * 100}%`,
              height: `${(item.height / BOARD_HEIGHT) * 100}%`,
              zIndex: itemLayer.get(item.id),
              transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`,
            }}
          >
            {item.kind === 'image' ? (
              <img src={activeImageSource(item)} alt="" draggable={false} />
            ) : item.kind === 'sticky-note' ? (
              <StickyNoteContent note={item} />
            ) : item.kind === 'text-box' ? (
              <TextBoxContent box={item} />
            ) : (
              <ShapeContent
                arrowDirection={item.arrowDirection}
                color={item.color}
                filled={item.filled}
                shape={item.shape}
              />
            )}
          </span>
        ),
      )}
      {inkRuns.map((run) => (
        <svg
          key={run.id}
          className="slide-preview-ink"
          viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
          preserveAspectRatio="none"
          style={{ zIndex: run.layer }}
        >
          {run.strokes.map((stroke) => (
            <InkStrokePath key={stroke.id} stroke={stroke} />
          ))}
        </svg>
      ))}
    </span>
  );
}
