/**
 * The seam between the two views, and the control that chooses between them.
 *
 * The sequence tree and the flowchart are two views of one graph. They share
 * selection, the collapse set, search and execution state, so they stay one
 * React root — but which of them is on screen is a layout decision a reader
 * (or an embedded LabVIEW panel) makes often, and it deserves a surface of its
 * own rather than a boolean behind a chevron.
 *
 * That surface is this bar. It is *always* rendered, in all three modes, and
 * that is the whole reason it is a component rather than two lines in
 * `App.tsx`: the control that brings a hidden view back cannot live inside the
 * view it hides. It replaces a `❯`/`❮` toggle button, which could only ever
 * express two of the three states and took a strip of chrome to do it.
 *
 * Dragging resizes only in `both` — in the single-view modes there is nothing
 * on the other side of the seam to trade width with, so the bar keeps its rule
 * and its menu and drops the `col-resize` affordance rather than offering a
 * drag that would do nothing.
 */

import { useCallback, useEffect, useState } from 'react';

import { Icon, type IconName } from './Icon';
import type { ViewMode } from '../bridge/protocol';

interface MenuItem {
  mode: ViewMode;
  label: string;
  icon: IconName;
}

const ITEMS: readonly MenuItem[] = [
  { mode: 'tree', label: 'Sequence tree only', icon: 'account_tree' },
  { mode: 'canvas', label: 'Flowchart only', icon: 'schema' },
  { mode: 'both', label: 'Both', icon: 'vertical_split' },
];

export interface SplitBarProps {
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  /** From `useResizable` — live only while both views are showing. */
  onHandleDown: (e: React.PointerEvent) => void;
  onReset: () => void;
}

export function SplitBar({ mode, onMode, onHandleDown, onReset }: SplitBarProps): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const resizable = mode === 'both';

  /*
   * Dismissal. `pointerdown` rather than `click` so the menu is gone before
   * whatever was clicked underneath reacts, and `capture` on scroll because a
   * fixed-position menu does not move with the pane it was opened over — a
   * scroll would leave it pointing at a row that has slid away.
   */
  useEffect(() => {
    if (menu === null) return;
    const close = (): void => setMenu(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  /*
   * Keep the menu on screen.
   *
   * It opens at the pointer, and the pointer is on the seam — which in
   * `tree` mode is the right edge of the window and in `canvas` mode the
   * left. So the one mode where this menu is the *only* way back to the other
   * view is also the mode where a menu drawn rightwards from the pointer
   * falls entirely outside the viewport. Measured and flipped rather than
   * guessed at from a hard-coded width, so it survives a longer label.
   *
   * Done on a callback ref instead of in state: the clamp is a property of
   * where the element landed, and routing it back through a render would mean
   * a frame where the menu is visibly in the wrong place.
   */
  const place = useCallback(
    (el: HTMLDivElement | null): void => {
      if (el === null || menu === null) return;
      const { width, height } = el.getBoundingClientRect();
      const pad = 6;
      const x = Math.max(pad, Math.min(menu.x, window.innerWidth - width - pad));
      const y = Math.max(pad, Math.min(menu.y, window.innerHeight - height - pad));
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    },
    [menu],
  );

  const pick = (next: ViewMode): void => {
    setMenu(null);
    onMode(next);
  };

  return (
    <>
      <div
        className={`split-bar${resizable ? ' resizable' : ''}`}
        role="separator"
        aria-orientation="vertical"
        title={
          resizable
            ? 'Drag to resize — double-click to reset — right-click for view options'
            : 'Right-click for view options'
        }
        onPointerDown={resizable ? onHandleDown : undefined}
        onDoubleClick={resizable ? onReset : undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      />

      {menu !== null && (
        <div
          ref={place}
          className="view-menu"
          role="menu"
          aria-label="View"
          style={{ left: menu.x, top: menu.y }}
          // The dismissal listener is on the window, so a click that lands
          // inside the menu would close it before the item's own handler ran.
          onPointerDown={(e) => e.stopPropagation()}
        >
          {ITEMS.map((item) => (
            <button
              key={item.mode}
              type="button"
              role="menuitemradio"
              aria-checked={mode === item.mode}
              className={mode === item.mode ? 'on' : undefined}
              onClick={() => pick(item.mode)}
            >
              <Icon name={item.icon} />
              {item.label}
              {mode === item.mode && <Icon name="check" className="tick" />}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
