'use client';

import {
  Brush,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Eraser,
  MousePointer2,
  Pen,
  Redo2,
  ScanText,
  Undo2,
  UserRound,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';

type Tool = {
  label: string;
  icon: LucideIcon | null;
  menu?: boolean;
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

export default function Home() {
  const [selectedTool, setSelectedTool] = useState(2);

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

      <div className="commandbar" aria-hidden="true">
        <div className="history-controls">
          <Undo2 />
          <Redo2 />
        </div>
        <span className="command-divider" />
        <div className="zoom-control">
          <ZoomIn />
          <ChevronDown />
        </div>
        <span className="command-divider" />
        <span className="command-label background-label">Set background</span>
        <span className="command-divider" />
        <span className="command-label clear-label">Clear frame</span>
      </div>

      <section className="workspace" aria-label="Blank board">
        <div className="board" />
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
