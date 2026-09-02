/**
 * Small pointer-based drag-resize hook, and a matching persisted-state hook.
 *
 * No resizable-panel library is installed, and pulling one in for a single
 * drag handle would be a lot of bundle for a little mechanism — consistent
 * with the rest of this app, which added zero dependencies through three
 * phases of analysis work. `localStorage` is used directly rather than
 * through a state library: these are per-viewer UI preferences (panel width,
 * text size, whether the flowchart is shown), not app state, and they are
 * the only things this app keeps outside `sessionStorage`/React state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A private window or a full quota must not break the app over a saved
    // panel width — the preference just does not survive reload.
  }
}

/** A piece of state that survives reload, for preferences too small to be
 * worth an app-level reducer. `serialise`/`parse` default to plain strings. */
export function usePersistedState<T>(
  key: string,
  initial: T,
  parse: (raw: string) => T = (raw) => raw as unknown as T,
  serialise: (value: T) => string = (value) => String(value),
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = readStorage(key);
    if (raw === null) return initial;
    try {
      return parse(raw);
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      writeStorage(key, serialise(next));
    },
    [key, serialise],
  );

  return [value, set];
}

export type ResizeAxis = 'horizontal' | 'vertical';

export interface Resizable {
  size: number;
  /** Attach to a handle's `onPointerDown`. */
  onHandleDown: (e: React.PointerEvent) => void;
  /** Restore the size this hook was given as `initial`. */
  reset: () => void;
}

/**
 * A single draggable dimension, persisted across reloads.
 *
 * `min`/`max` are read fresh on every drag start rather than baked into a
 * closure, so a caller can shrink `max` when the window resizes (e.g. `70vw`)
 * without needing to reset the drag in progress.
 *
 * `invert` is what makes the handle track the cursor rather than run away
 * from it. When the resized element sits *before* the handle in flow order
 * (the outline panel, left of its vertical handle), growing it moves the
 * handle the same direction the cursor dragged, so `size` should move with
 * raw delta. When it sits *after* the handle (the details section, below its
 * horizontal handle), growing it moves the handle the *opposite* way the
 * cursor dragged — the handle's own position is `container height − size`,
 * not `size` — so the delta has to be negated or every drag on that handle
 * inverts.
 */
export function useResizable(
  storageKey: string,
  initial: number,
  min: number,
  max: number,
  axis: ResizeAxis,
  invert = false,
): Resizable {
  const [size, setSize] = usePersistedState<number>(
    storageKey,
    initial,
    (raw) => clamp(Number(raw), min, max),
    (n) => String(n),
  );

  const dragging = useRef(false);
  const start = useRef({ pos: 0, size: 0 });
  const bounds = useRef({ min, max });
  bounds.current = { min, max };

  const onHandleDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      start.current = { pos: axis === 'horizontal' ? e.clientX : e.clientY, size };
      document.body.style.cursor = axis === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [axis, size],
  );

  useEffect(() => {
    const move = (e: PointerEvent): void => {
      if (!dragging.current) return;
      const pos = axis === 'horizontal' ? e.clientX : e.clientY;
      const delta = (pos - start.current.pos) * (invert ? -1 : 1);
      setSize(clamp(start.current.size + delta, bounds.current.min, bounds.current.max));
    };
    const up = (): void => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [axis, invert, setSize]);

  const reset = useCallback(() => setSize(clamp(initial, min, max)), [initial, min, max, setSize]);

  return { size, onHandleDown, reset };
}
