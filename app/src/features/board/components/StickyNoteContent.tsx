import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';

import { getStickyNoteColorValue } from '../constants';
import type { CanvasStickyNote } from '../types';
import { stickyNoteFontScale } from '../utils';

type StickyNoteContentProps = {
  note: CanvasStickyNote;
  draft?: string;
  onDraftChange?: (text: string) => void;
  onFinishEditing?: () => void;
};

export function StickyNoteContent({
  note,
  draft,
  onDraftChange,
  onFinishEditing,
}: StickyNoteContentProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const text = draft ?? note.text;
  const isEditing = draft !== undefined;
  const [layout, setLayout] = useState(() => ({
    scale: stickyNoteFontScale(text),
    dense: stickyNoteFontScale(text) <= 12.5,
    overflowing: false,
  }));
  const style = {
    '--sticky-font-size': `${layout.scale}cqw`,
    '--sticky-note-color': getStickyNoteColorValue(note.color),
  } as CSSProperties;

  const measureText = useCallback(() => {
    const surface = surfaceRef.current;
    const measure = measureRef.current;
    if (!surface || !measure || surface.clientWidth === 0) return;

    if (!text.trim()) {
      setLayout((current) =>
        current.scale === 19 && !current.dense && !current.overflowing
          ? current
          : { scale: 19, dense: false, overflowing: false },
      );
      return;
    }

    const minimumScale = 8.5;
    const maximumScale = 54;
    const fits = (scale: number) => {
      measure.style.fontSize = `${(surface.clientWidth * scale) / 100}px`;
      return (
        measure.scrollWidth <= measure.clientWidth + 1 &&
        measure.scrollHeight <= measure.clientHeight + 1
      );
    };
    const overflowing = !fits(minimumScale);
    let scale = minimumScale;

    if (!overflowing) {
      let low = minimumScale;
      let high = maximumScale;
      for (let index = 0; index < 12; index += 1) {
        const middle = (low + high) / 2;
        if (fits(middle)) low = middle;
        else high = middle;
      }
      scale = Math.round(low * 10) / 10;
    }

    const dense = scale <= 12.5;
    setLayout((current) =>
      current.scale === scale &&
      current.dense === dense &&
      current.overflowing === overflowing
        ? current
        : { scale, dense, overflowing },
    );
  }, [text]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    let isCurrent = true;
    let animationFrame = window.requestAnimationFrame(measureText);
    void document.fonts.ready.then(() => {
      if (isCurrent) measureText();
    });
    if (!surface || typeof ResizeObserver === 'undefined') {
      return () => {
        isCurrent = false;
        window.cancelAnimationFrame(animationFrame);
      };
    }

    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(measureText);
    });
    observer.observe(surface);
    return () => {
      isCurrent = false;
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [measureText]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.style.height = '0px';
    editor.style.height = `${editor.scrollHeight}px`;
  }, [layout.scale, text]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.blur();
  };

  return (
    <div
      ref={surfaceRef}
      className={`sticky-note-surface${layout.dense ? ' is-dense' : ''}${
        layout.overflowing ? ' is-overflowing' : ''
      }${note.color === 'transparent' ? ' is-transparent' : ''}`}
      style={style}
    >
      <div className="sticky-note-copy-shell">
        {isEditing ? (
          <textarea
            ref={editorRef}
            className="sticky-note-copy sticky-note-editor"
            aria-label="Sticky note text"
            autoFocus
            value={text}
            rows={1}
            spellCheck
            onBlur={onFinishEditing}
            onChange={(event) => onDraftChange?.(event.currentTarget.value)}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={handleKeyDown}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : (
          <div className="sticky-note-copy">{text}</div>
        )}
      </div>
      <div ref={measureRef} className="sticky-note-measure" aria-hidden="true">
        {text}
      </div>
    </div>
  );
}
