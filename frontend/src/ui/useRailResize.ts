import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { DESKTOP_QUERY, useMediaQuery } from './useMediaQuery';

export const RAIL_STORAGE_KEY = 'br-chat-rail-width';
export const RAIL_MIN = 300;
export const RAIL_MAX = 640;
export const RAIL_DEFAULT = 360;
const KEY_STEP = 16;

/** Computes max expandable width: defaults to half the viewport (min 50% width). */
export function computeRailMax(customMax?: number, min = RAIL_MIN): number {
  if (customMax !== undefined) return customMax;
  if (typeof window === 'undefined') return RAIL_MAX;
  return Math.max(min, Math.floor(window.innerWidth / 2));
}

export interface UseRailResizeOptions {
  storageKey?: string;
  min?: number;
  max?: number;
  initial?: number;
  step?: number;
  /** Docking side: right rails expand leftward; left rails expand rightward. */
  side?: 'left' | 'right';
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
  side: 'left' | 'right';
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
 * Resizable docked rail: pointer drag and Arrow keys (+/-16px), Home, End on a separator,
 * clamped between min and half the viewport (or options.max), stored in localStorage.
 * Only active at min-width 901px.
 */
export function useRailResize(options: UseRailResizeOptions = {}): RailResize {
  const {
    storageKey = RAIL_STORAGE_KEY,
    min = RAIL_MIN,
    max: customMax,
    initial = RAIL_DEFAULT,
    step = KEY_STEP,
    side = 'right',
  } = options;

  const [max, setMax] = useState(() => computeRailMax(customMax, min));
  const clamp = useCallback((value: number) => Math.min(max, Math.max(min, Math.round(value))), [min, max]);
  const enabled = useMediaQuery(DESKTOP_QUERY);

  const [width, setWidth] = useState(() => clamp(readStored(storageKey) ?? initial));
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  const drag = useRef<{ x: number; width: number } | null>(null);

  // Keep max aligned with half of the viewport width across window resizes.
  useEffect(() => {
    const handleResize = () => {
      const nextMax = computeRailMax(customMax, min);
      setMax(nextMax);
      setWidth((curr) => {
        const next = Math.min(nextMax, Math.max(min, curr));
        widthRef.current = next;
        return next;
      });
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [customMax, min]);

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
      const delta = side === 'left' ? event.clientX - drag.current.x : drag.current.x - event.clientX;
      apply(drag.current.width + delta, false);
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onKeyDown(event) {
      const widenKey = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
      const narrowKey = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
      const keys: Record<string, number> = {
        [widenKey]: widthRef.current + step,
        [narrowKey]: widthRef.current - step,
        Home: min,
        End: max,
      };
      const next = keys[event.key];
      if (next === undefined) return;
      event.preventDefault();
      apply(next, true);
    },
  };

  return { width, enabled, dragging, min, max, side, handleProps };
}
