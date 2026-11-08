import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { DESKTOP_QUERY, useMediaQuery } from './useMediaQuery';

export const RAIL_STORAGE_KEY = 'br-chat-rail-width';
export const RAIL_MIN = 300;
export const RAIL_MAX = 640;
export const RAIL_DEFAULT = 360;
const KEY_STEP = 16;

export interface UseRailResizeOptions {
  storageKey?: string;
  min?: number;
  max?: number;
  initial?: number;
  step?: number;
}

export interface RailResizeHandleProps {
  role: 'separator';
  'aria-orientation': 'vertical';
  'aria-valuemin': number;
  'aria-valuemax': number;
  'aria-valuenow': number;
  tabIndex: 0;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export interface RailResize {
  /** Current clamped width in px: pass to `<Rail width>`. */
  width: number;
  /** True at >= 901px; the handle should not render below that. */
  enabled: boolean;
  dragging: boolean;
  min: number;
  max: number;
  /** Spread on the separator element (see `<RailResizeHandle>`). */
  handleProps: RailResizeHandleProps;
}

function readStored(key: string): number | null {
  try {
    const value = Number.parseFloat(window.localStorage.getItem(key) ?? '');
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Private mode or blocked storage: the width just won't persist.
  }
}

/**
 * Resizable right-docked rail (port of the shell.js chat-rail resize): pointer drag and
 * ArrowLeft/ArrowRight (+/-16px), Home, End on a separator, clamped to min..max, stored
 * in localStorage. Only active at min-width 901px.
 */
export function useRailResize(options: UseRailResizeOptions = {}): RailResize {
  const {
    storageKey = RAIL_STORAGE_KEY,
    min = RAIL_MIN,
    max = RAIL_MAX,
    initial = RAIL_DEFAULT,
    step = KEY_STEP,
  } = options;
  const clamp = useCallback((value: number) => Math.min(max, Math.max(min, Math.round(value))), [min, max]);
  const enabled = useMediaQuery(DESKTOP_QUERY);

  const [width, setWidth] = useState(() => clamp(readStored(storageKey) ?? initial));
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  const drag = useRef<{ x: number; width: number } | null>(null);

  const apply = useCallback(
    (value: number, persist: boolean) => {
      const next = clamp(value);
      widthRef.current = next;
      setWidth(next);
      if (persist) writeStored(storageKey, next);
    },
    [clamp, storageKey],
  );

  useEffect(() => {
    document.body.classList.toggle('rail-resizing', dragging);
    return () => document.body.classList.remove('rail-resizing');
  }, [dragging]);

  const endDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!drag.current) return;
      drag.current = null;
      setDragging(false);
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      apply(widthRef.current, true);
    },
    [apply],
  );

  const handleProps: RailResizeHandleProps = {
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': width,
    tabIndex: 0,
    onPointerDown(event) {
      if (!enabled) return;
      event.preventDefault();
      drag.current = { x: event.clientX, width: widthRef.current };
      setDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove(event) {
      if (!drag.current) return;
      // The rail docks right, so moving the pointer left widens it.
      apply(drag.current.width + drag.current.x - event.clientX, false);
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onKeyDown(event) {
      const keys: Record<string, number> = {
        ArrowLeft: widthRef.current + step,
        ArrowRight: widthRef.current - step,
        Home: min,
        End: max,
      };
      const next = keys[event.key];
      if (next === undefined) return;
      event.preventDefault();
      apply(next, true);
    },
  };

  return { width, enabled, dragging, min, max, handleProps };
}
