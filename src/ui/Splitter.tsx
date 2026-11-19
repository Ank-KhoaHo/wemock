import { type KeyboardEvent, type PointerEvent, type RefObject, useRef, useState } from 'react';
import { GripIcon } from './icons';

const MIN_PANE_PX = 280;
const KEY_STEP_PX = 16;
const BIG_KEY_STEP_PX = 64;

function storageKey(view: string): string {
  return `wemock.paneWidth.${view}`;
}

function readWidth(view: string): number | null {
  try {
    const width = Number(localStorage.getItem(storageKey(view)));
    return width > 0 ? width : null;
  } catch {
    return null;
  }
}

function writeWidth(view: string, width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(storageKey(view));
    else localStorage.setItem(storageKey(view), String(width));
  } catch {
    // Storage may be unavailable.
  }
}

export function clampPaneWidth(width: number, containerWidth: number): number {
  const max = Math.max(MIN_PANE_PX, containerWidth - MIN_PANE_PX);
  return Math.round(Math.min(Math.max(width, MIN_PANE_PX), max));
}

export function usePaneWidth(view: string) {
  const [width, setWidth] = useState<number | null>(() => readWidth(view));
  const resize = (next: number | null) => {
    setWidth(next);
    writeWidth(view, next);
  };
  const style = width === null ? undefined : { width, minWidth: 0, maxWidth: 'none' };
  return { resize, style };
}

export interface SplitterProps {
  paneRef: RefObject<HTMLElement | null>;
  onResize: (width: number | null) => void;
}

export function Splitter({ paneRef, onResize }: Readonly<SplitterProps>) {
  const [dragging, setDragging] = useState(false);
  const dragWidthRef = useRef<number | null>(null);
  const frameRef = useRef(0);

  const clampToContainer = (next: number): number | null => {
    const container = paneRef.current?.parentElement;
    return container ? clampPaneWidth(next, container.clientWidth) : null;
  };

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  // Set the width directly while dragging: re-rendering the panel on every move stutters.
  const handlePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const pane = paneRef.current;
    const container = pane?.parentElement;
    if (!dragging || !pane || !container) return;
    dragWidthRef.current = clampToContainer(container.getBoundingClientRect().right - e.clientX);
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      if (dragWidthRef.current === null) return;
      pane.style.width = `${dragWidthRef.current}px`;
      pane.style.minWidth = '0';
      pane.style.maxWidth = 'none';
    });
  };

  const endDrag = () => {
    cancelAnimationFrame(frameRef.current);
    setDragging(false);
    if (dragWidthRef.current !== null) onResize(dragWidthRef.current);
    dragWidthRef.current = null;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.shiftKey ? BIG_KEY_STEP_PX : KEY_STEP_PX;
    const current = paneRef.current?.offsetWidth ?? 0;
    const next = clampToContainer(e.key === 'ArrowLeft' ? current + step : current - step);
    if (next !== null) onResize(next);
  };

  return (
    <button
      type="button"
      aria-label="Resize the panes"
      title="Drag or use the arrow keys to resize; double-click to reset"
      data-testid="split-handle"
      className={dragging ? 'split-handle dragging' : 'split-handle'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onResize(null)}
      onKeyDown={handleKeyDown}
    >
      <GripIcon size={14} />
    </button>
  );
}
