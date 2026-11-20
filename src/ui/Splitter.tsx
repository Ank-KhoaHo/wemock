import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { GripIcon, MaximizeIcon, MinimizeIcon, ResizeCornerIcon } from './icons';

const MIN_PANE_PX = 280;
const MIN_BODY_PX = 200;
const KEY_STEP_PX = 16;
const BIG_KEY_STEP_PX = 64;
const EDGE_PX = 32;
const SCROLL_STEP_PX = 16;

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

interface Point {
  clientX: number;
  clientY: number;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === 'auto' || overflowY === 'scroll') return parent;
  }
  return null;
}

interface AxisRules {
  icon: ReactNode;
  fromPointer: (target: HTMLElement, at: Point) => number;
  clamp: (size: number, target: HTMLElement) => number;
  apply: (target: HTMLElement, size: number) => void;
  current: (target: HTMLElement) => number;
  growKey: string;
  shrinkKey: string;
  autoScroll?: (target: HTMLElement, at: Point) => void;
}

const AXES: Record<'x' | 'y', AxisRules> = {
  x: {
    icon: <GripIcon size={14} />,
    fromPointer: (target, at) => (target.parentElement?.getBoundingClientRect().right ?? 0) - at.clientX,
    clamp: (size, target) => clampPaneWidth(size, target.parentElement?.clientWidth ?? 0),
    apply: (target, size) => {
      target.style.width = `${size}px`;
      target.style.minWidth = '0';
      target.style.maxWidth = 'none';
    },
    current: (target) => target.offsetWidth,
    growKey: 'ArrowLeft',
    shrinkKey: 'ArrowRight',
  },
  y: {
    icon: <ResizeCornerIcon size={14} />,
    fromPointer: (target, at) => at.clientY - target.getBoundingClientRect().top,
    clamp: (size) => Math.round(Math.max(size, MIN_BODY_PX)),
    apply: (target, size) => {
      target.style.minHeight = `${size}px`;
    },
    current: (target) => target.offsetHeight,
    growKey: 'ArrowDown',
    shrinkKey: 'ArrowUp',
    // Holding the pointer at the bottom of the pane scrolls it, so the body keeps growing.
    autoScroll: (target, at) => {
      const scroller = scrollParent(target);
      if (scroller && at.clientY > scroller.getBoundingClientRect().bottom - EDGE_PX) {
        scroller.scrollTop += SCROLL_STEP_PX;
      }
    },
  },
};

export interface ResizeHandleProps {
  targetRef: RefObject<HTMLElement | null>;
  axis: 'x' | 'y';
  label: string;
  testId: string;
  onResize: (size: number | null) => void;
}

export function ResizeHandle({ targetRef, axis, label, testId, onResize }: Readonly<ResizeHandleProps>) {
  const [dragging, setDragging] = useState(false);
  const pointerRef = useRef<Point | null>(null);
  const sizeRef = useRef<number | null>(null);
  const frameRef = useRef(0);
  const rules = AXES[axis];

  const sizeAtPointer = (target: HTMLElement, at: Point) => rules.clamp(rules.fromPointer(target, at), target);

  // The size is set on the target once a frame while dragging, not through React state:
  // re-rendering the panel on every move stutters.
  const followPointer = () => {
    const target = targetRef.current;
    const at = pointerRef.current;
    if (target && at) {
      rules.autoScroll?.(target, at);
      sizeRef.current = sizeAtPointer(target, at);
      rules.apply(target, sizeRef.current);
    }
    frameRef.current = requestAnimationFrame(followPointer);
  };

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    frameRef.current = requestAnimationFrame(followPointer);
  };

  const handlePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) pointerRef.current = { clientX: e.clientX, clientY: e.clientY };
  };

  const endDrag = () => {
    cancelAnimationFrame(frameRef.current);
    const target = targetRef.current;
    const at = pointerRef.current;
    if (target && at) sizeRef.current = sizeAtPointer(target, at);
    setDragging(false);
    if (sizeRef.current !== null) onResize(sizeRef.current);
    pointerRef.current = null;
    sizeRef.current = null;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const target = targetRef.current;
    if (!target || (e.key !== rules.growKey && e.key !== rules.shrinkKey)) return;
    e.preventDefault();
    const step = e.shiftKey ? BIG_KEY_STEP_PX : KEY_STEP_PX;
    const current = rules.current(target);
    onResize(rules.clamp(e.key === rules.growKey ? current + step : current - step, target));
  };

  return (
    <button
      type="button"
      aria-label={label}
      title="Drag or use the arrow keys to resize; double-click to reset"
      data-testid={testId}
      className={`resize-handle resize-handle-${axis}${dragging ? ' dragging' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onResize(null)}
      onKeyDown={handleKeyDown}
    >
      {rules.icon}
    </button>
  );
}

export interface SplitterProps {
  paneRef: RefObject<HTMLElement | null>;
  onResize: (width: number | null) => void;
}

export function Splitter({ paneRef, onResize }: Readonly<SplitterProps>) {
  return <ResizeHandle targetRef={paneRef} axis="x" label="Resize the panes" testId="split-handle" onResize={onResize} />;
}

export function ResizableBody({ children }: Readonly<{ children: ReactNode }>) {
  const [minHeight, setMinHeight] = useState<number | null>(null);
  const [overlayRoot, setOverlayRoot] = useState<Element | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const maximized = overlayRoot !== null;

  useEffect(() => {
    if (!maximized) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOverlayRoot(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [maximized]);

  // The panel root, not the body's place: the editor body is its own stacking context, so an
  // overlay left there would sit under the sticky editor header.
  const toggleMaximized = () => setOverlayRoot(maximized ? null : (bodyRef.current?.closest('.wm') ?? null));

  const body = (
    <div
      className={maximized ? 'resizable-body maximized' : 'resizable-body'}
      ref={bodyRef}
      style={!maximized && minHeight !== null ? { minHeight } : undefined}
    >
      {children}
      <button
        type="button"
        data-testid="body-maximize"
        className="maximize-btn"
        aria-label={maximized ? 'Restore the body' : 'Maximize the body'}
        title={maximized ? 'Restore (Esc)' : 'Maximize'}
        onClick={toggleMaximized}
      >
        {maximized ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
      </button>
      {!maximized && (
        <ResizeHandle targetRef={bodyRef} axis="y" label="Resize the body" testId="body-resize-handle" onResize={setMinHeight} />
      )}
    </div>
  );

  return overlayRoot ? createPortal(body, overlayRoot) : body;
}
