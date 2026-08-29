/**
 * The canvas. React Flow with minimap, controls, pan, zoom and fit-to-view.
 *
 * Node positions are component state: dragging a node moves it, and Re-layout
 * puts everything back where ELK had it. Nothing here writes to the sequence
 * file — the tool is read-only (NFR-4).
 */

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect } from 'react';

import { EDGE_COLOR, type FlowEdge, type FlowNode, type FlowNodeData } from '../emit/flow';
import { nodeTypes } from './nodes';

const KIND_COLOR: Record<string, string> = {
  action: '#3c86c9',
  decision: '#c98f2e',
  criteria: '#cf5b52',
  jump: '#9a6bd0',
  container: '#2a313d',
};

export interface CanvasProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onNodesChange: (changes: unknown[]) => void;
  onSelect: (uid: string | null) => void;
  /** Bumped whenever a fresh layout lands, to refit the view. */
  layoutKey: number;
}

export function Canvas({
  nodes,
  edges,
  onNodesChange,
  onSelect,
  layoutKey,
}: CanvasProps): React.JSX.Element {
  const flow = useReactFlow();

  // Positions move wholesale on re-layout; refit rather than leaving the user
  // looking at empty canvas.
  useEffect(() => {
    if (layoutKey === 0) return;
    const id = window.setTimeout(() => void flow.fitView({ padding: 0.12 }), 60);
    return () => window.clearTimeout(id);
  }, [layoutKey, flow]);

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    onSelect(node.id);
  };

  return (
    <ReactFlow
      nodes={nodes as unknown as Node[]}
      edges={edges as unknown as Edge[]}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange as never}
      onNodeClick={handleNodeClick}
      onPaneClick={() => onSelect(null)}
      nodesConnectable={false}
      edgesFocusable={false}
      elementsSelectable
      minZoom={0.02}
      maxZoom={2.5}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: 'smoothstep' }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#252b36" />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        maskColor="rgba(10,12,16,0.72)"
        nodeColor={(n) => {
          const data = n.data as unknown as FlowNodeData;
          return KIND_COLOR[data.kind] ?? EDGE_COLOR['fallthrough']!;
        }}
      />
    </ReactFlow>
  );
}
