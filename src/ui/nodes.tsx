/**
 * Custom node components, one per shape from the rule file.
 *
 * Shapes are cut with CSS clip-path rather than by rotating a box, so the text
 * stays horizontal inside a diamond.
 */

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';

import type { FlowNodeData } from '../emit/flow';

type Props = NodeProps & { data: FlowNodeData };

function StepNode({ data, selected }: Props): React.JSX.Element {
  // A collapsed sequence arrives here as a node rather than a group — one
  // opaque box standing in for everything inside it.
  const isCollapsed = data.collapsed !== undefined;
  const classes = [
    'rf-node',
    `shape-${data.shape}`,
    selected ? 'selected' : '',
    data.convergent ? 'convergent' : '',
    isCollapsed ? 'collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const title = isCollapsed
    ? `${data.label} — ${data.collapsed ?? 0} steps hidden. Double-click to expand.`
    : `${data.element} — ${data.label}`;

  return (
    <div className={classes} title={title}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="label">{data.label}</div>
      {data.params !== '' && <div className="params">{data.params}</div>}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

function GroupNode({ data, selected }: Props): React.JSX.Element {
  return (
    <div
      className={`rf-group${selected ? ' selected' : ''}`}
      // Semantic zoom drops the titles of deeply nested sequences: far out
      // there is no room for 26 of them, and only the outer ones orient you.
      data-depth={data.depth}
      title={`${data.label} — double-click to collapse`}
    >
      <div className="title">{data.label}</div>
    </div>
  );
}

export const nodeTypes = {
  seqNode: memo(StepNode),
  seqGroup: memo(GroupNode),
};
