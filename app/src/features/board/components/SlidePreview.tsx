import { BOARD_HEIGHT, BOARD_WIDTH } from '../constants';
import type { CanvasImage } from '../types';

type SlidePreviewProps = {
  images: CanvasImage[];
};

export function SlidePreview({ images }: SlidePreviewProps) {
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
          <img src={image.src} alt="" draggable={false} />
        </span>
      ))}
    </span>
  );
}
