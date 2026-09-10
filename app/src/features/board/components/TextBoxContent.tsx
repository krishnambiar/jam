import {
  useCallback,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';

import {
  TEXT_BOX_MIN_HEIGHT,
  getTextBoxColorValue,
  getTextBoxStyle,
} from '../constants';
import type { CanvasTextBox } from '../types';

type TextBoxContentProps = {
  box: CanvasTextBox;
  draft?: string;
  onDraftChange?: (text: string) => void;
  onFinishEditing?: () => void;
  onHeightChange?: (height: number) => void;
};

export function TextBoxContent({
  box,
  draft,
  onDraftChange,
  onFinishEditing,
  onHeightChange,
}: TextBoxContentProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const onHeightChangeRef = useRef(onHeightChange);
  const text = draft ?? box.text;
  const isEditing = draft !== undefined;
  const preset = getTextBoxStyle(box.style);
  const fontSize = preset.fontSize * box.scale;
  const style = {
    '--text-box-color': getTextBoxColorValue(box.color),
    '--text-box-font-size': `${(fontSize / Math.max(box.width, 1)) * 100}cqw`,
    '--text-box-font-weight': preset.fontWeight,
    '--text-box-line-height': preset.lineHeight,
    '--text-box-alignment': box.alignment,
    '--text-box-padding-x': `${
      ((8 * box.scale) / Math.max(box.width, 1)) * 100
    }cqw`,
    '--text-box-padding-y': `${
      ((4 * box.scale) / Math.max(box.width, 1)) * 100
    }cqw`,
  } as CSSProperties;

  const measureHeight = useCallback(() => {
    const surface = surfaceRef.current;
    const measure = measureRef.current;
    if (!surface || !measure || surface.clientWidth === 0) return;

    const boardHeight = Math.max(
      TEXT_BOX_MIN_HEIGHT * box.scale,
      (measure.scrollHeight / surface.clientWidth) * box.width,
    );
    onHeightChangeRef.current?.(Math.round(boardHeight * 10) / 10);
  }, [box.scale, box.width]);

  useLayoutEffect(() => {
    onHeightChangeRef.current = onHeightChange;
  }, [onHeightChange]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    let isCurrent = true;
    let animationFrame = window.requestAnimationFrame(measureHeight);
    void document.fonts?.ready.then(() => {
      if (isCurrent) measureHeight();
    });
    if (!surface || typeof ResizeObserver === 'undefined') {
      return () => {
        isCurrent = false;
        window.cancelAnimationFrame(animationFrame);
      };
    }

    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(measureHeight);
    });
    observer.observe(surface);
    return () => {
      isCurrent = false;
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [measureHeight, text]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }, [isEditing]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.blur();
  };

  return (
    <div
      ref={surfaceRef}
      className={`text-box-surface${isEditing ? ' is-editing' : ''}`}
      style={style}
      onPointerDown={(event) => {
        if (!isEditing || event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        event.stopPropagation();
        editorRef.current?.focus({ preventScroll: true });
      }}
      onDoubleClick={(event) => {
        if (isEditing) event.stopPropagation();
      }}
    >
      {isEditing ? (
        <textarea
          ref={editorRef}
          className="text-box-copy text-box-editor"
          aria-label="Text box text"
          autoFocus
          value={text}
          rows={1}
          spellCheck
          onBlur={(event) => {
            const nextTarget = event.relatedTarget;
            if (
              nextTarget instanceof Element &&
              nextTarget.closest('[data-text-format-toolbar]')
            ) {
              return;
            }
            onFinishEditing?.();
          }}
          onChange={(event) => onDraftChange?.(event.currentTarget.value)}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={handleKeyDown}
          onPointerDown={(event) => event.stopPropagation()}
        />
      ) : (
        <div className="text-box-copy">{text}</div>
      )}
      <div ref={measureRef} className="text-box-measure" aria-hidden="true">
        {text || '\u200b'}
      </div>
    </div>
  );
}
