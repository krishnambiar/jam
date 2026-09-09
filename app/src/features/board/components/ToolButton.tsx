import { ChevronRight } from 'lucide-react';
import type { Ref } from 'react';

import type { Tool } from '../types';

type ToolButtonProps = {
  buttonRef?: Ref<HTMLButtonElement>;
  controls?: string;
  expanded?: boolean;
  tool: Tool;
  selected: boolean;
  onSelect: () => void;
};

export function ToolButton({
  buttonRef,
  controls,
  expanded,
  tool,
  selected,
  onSelect,
}: ToolButtonProps) {
  const Icon = tool.icon;

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`tool-button${selected ? ' is-selected' : ''}`}
      aria-label={tool.label}
      aria-pressed={selected}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-keyshortcuts={tool.shortcut}
      title={
        tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label
      }
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
