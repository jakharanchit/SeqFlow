/**
 * The seam between the two views.
 *
 * Which view is on screen is chosen only over the LabVIEW bridge (`setView`);
 * there is no on-screen control for it. The seam is the resize handle while
 * both views show, and a plain rule in the single-view modes, where there is
 * nothing on the other side to trade width with.
 */

import type { ViewMode } from '../bridge/protocol';

export interface SplitBarProps {
  mode: ViewMode;
  /** From `useResizable` — live only while both views are showing. */
  onHandleDown: (e: React.PointerEvent) => void;
  onReset: () => void;
}

export function SplitBar({ mode, onHandleDown, onReset }: SplitBarProps): React.JSX.Element {
  const resizable = mode === 'both';
  return (
    <div
      className={`split-bar${resizable ? ' resizable' : ''}`}
      role="separator"
      aria-orientation="vertical"
      title={resizable ? 'Drag to resize — double-click to reset' : undefined}
      onPointerDown={resizable ? onHandleDown : undefined}
      onDoubleClick={resizable ? onReset : undefined}
    />
  );
}
