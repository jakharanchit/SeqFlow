/**
 * The seam between the two views: the resize handle.
 *
 * Which view is on screen is chosen only over the LabVIEW bridge (`setView`);
 * there is no on-screen control for it. App renders this only while both views
 * show — in the single-view modes there is nothing on the other side to trade
 * width with, so there is no seam at all.
 */

export interface SplitBarProps {
  /** From `useResizable`. */
  onHandleDown: (e: React.PointerEvent) => void;
  onReset: () => void;
}

export function SplitBar({ onHandleDown, onReset }: SplitBarProps): React.JSX.Element {
  return (
    <div
      className="split-bar"
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize — double-click to reset"
      onPointerDown={onHandleDown}
      onDoubleClick={onReset}
    />
  );
}
