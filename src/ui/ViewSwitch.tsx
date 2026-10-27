/**
 * On-screen view control. In `both`, each pane carries a close button; with
 * one pane closed, a single button reopens the other. Both drive the same
 * `viewMode` state the bridge's `setView` does, so `viewChanged` reports a
 * click like any change.
 */

import type { ViewMode } from '../bridge/protocol';
import { Icon } from './Icon';

export function ViewSwitch({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}): React.JSX.Element | null {
  if (mode === 'both') return null;
  const title = mode === 'tree' ? 'Open flowchart' : 'Open tree';
  return (
    <button
      type="button"
      className="view-switch"
      title={title}
      aria-label={title}
      onClick={() => onChange('both')}
    >
      <Icon name={mode === 'tree' ? 'account_tree' : 'list'} />
    </button>
  );
}

export function PaneClose({
  title,
  className,
  onClose,
}: {
  title: string;
  className: string;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`pane-close ${className}`}
      title={title}
      aria-label={title}
      onClick={onClose}
    >
      <Icon name="close" />
    </button>
  );
}
