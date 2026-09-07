import { ChevronRight } from 'lucide-react';

import type { Tool } from '../types';

type ToolButtonProps = {
  tool: Tool;
  selected: boolean;
  onSelect: () => void;
};

export function ToolButton({ tool, selected, onSelect }: ToolButtonProps) {
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
