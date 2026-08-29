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
  const classes = [
    'rf-node',
    `shape-${data.shape}`,
    selected ? 'selected' : '',
    data.convergent ? 'convergent' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} title={`${data.element} — ${data.label}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="label">{data.label}</div>
      {data.params !== '' && <div className="params">{data.params}</div>}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

function GroupNode({ data, selected }: Props): React.JSX.Element {
  return (
    <div className={`rf-group${selected ? ' selected' : ''}`}>
      <div className="title">{data.label}</div>
    </div>
  );
}

export const nodeTypes = {
  seqNode: memo(StepNode),
  seqGroup: memo(GroupNode),
};
