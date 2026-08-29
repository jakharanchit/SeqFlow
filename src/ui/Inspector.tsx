/**
 * Right-hand panel for the selected node.
 *
 * Shows every attribute verbatim — the parser does not decide what matters —
 * plus attributes lifted from non-step children, plus the raw XML. For a
 * ConditionStep the lifted Comparison is the actual condition, and is the
 * whole point of the panel.
 */

import type { Graph, SeqNode } from '../core/types';

export interface InspectorProps {
  graph: Graph | null;
  selected: string | null;
  /** uid -> raw XML for that element. */
  snippets: Map<string, string>;
  onSelect: (uid: string) => void;
}

function AttrTable({ attrs }: { attrs: Record<string, string> }): React.JSX.Element {
  const keys = Object.keys(attrs).sort();
  return (
    <table className="attrs">
      <tbody>
        {keys.map((k) => {
          const v = attrs[k] ?? '';
          return (
            <tr key={k}>
              <td className="k">{k}</td>
              <td className={v === '' ? 'v empty' : 'v'}>{v === '' ? 'empty' : v}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Ancestry({
  node,
  graph,
  onSelect,
}: {
  node: SeqNode;
  graph: Graph;
  onSelect: (uid: string) => void;
}): React.JSX.Element | null {
  const chain: SeqNode[] = [];
  let cursor = node.parent;
  while (cursor !== null) {
    const parent = graph.nodes.get(cursor);
    if (parent === undefined) break;
    chain.unshift(parent);
    cursor = parent.parent;
  }
  if (chain.length === 0) return null;

  return (
    <div className="section">
      <h3>In sequence</h3>
      <div className="hint">
        {chain.map((c, i) => (
          <span key={c.uid}>
            {i > 0 && ' › '}
            <a
              href="#"
              style={{ color: 'var(--accent)', textDecoration: 'none' }}
              onClick={(e) => {
                e.preventDefault();
                onSelect(c.uid);
              }}
            >
              {c.name}
            </a>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Inspector({
  graph,
  selected,
  snippets,
  onSelect,
}: InspectorProps): React.JSX.Element {
  if (graph === null) {
    return (
      <aside className="inspector">
        <p className="hint">Drop a sequence XML file onto the page to begin.</p>
      </aside>
    );
  }

  const node = selected === null ? undefined : graph.nodes.get(selected);
  if (node === undefined) {
    const counts = [...graph.nodes.values()].reduce<Record<string, number>>((acc, n) => {
      acc[n.element] = (acc[n.element] ?? 0) + 1;
      return acc;
    }, {});

    return (
      <aside className="inspector">
        <p className="hint">Select a node to inspect it.</p>
        <div className="section">
          <h3>Step types</h3>
          <table className="attrs">
            <tbody>
              {Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .map(([element, n]) => (
                  <tr key={element}>
                    <td className="k">{element}</td>
                    <td className="v">{n}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="section">
          <h3>Canvas</h3>
          <table className="attrs">
            <tbody>
              <tr>
                <td className="k">scroll</td>
                <td className="v">pan up and down</td>
              </tr>
              <tr>
                <td className="k">+ / −</td>
                <td className="v">zoom in / out</td>
              </tr>
              <tr>
                <td className="k">0 / 1</td>
                <td className="v">fit to view / 100%</td>
              </tr>
              <tr>
                <td className="k">double-click</td>
                <td className="v">collapse or expand a sequence</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="section">
          <h3>Edges</h3>
          <div className="legend">
            <span>
              <i style={{ borderTop: '2px solid #8a94a6' }} />
              fall-through
            </span>
            <span>
              <i style={{ borderTop: '2px solid #3b82c4' }} />
              branch
            </span>
            <span>
              <i style={{ borderTop: '2px dashed #d4544a' }} />
              criteria fail
            </span>
            <span>
              <i style={{ borderTop: '2px solid #9a6bd0' }} />
              goto
            </span>
          </div>
        </div>
      </aside>
    );
  }

  const inbound = graph.edges.filter((e) => e.dst === node.uid);
  const outbound = graph.edges.filter((e) => e.src === node.uid);
  const childAttrs = node.childAttrs ?? {};
  const snippet = snippets.get(node.uid);

  return (
    <aside className="inspector">
      <h2 className="insp-title">{node.name === '' ? node.element : node.name}</h2>
      <div className="insp-sub">
        <span className={`chip kind-${node.kind}`}>{node.kind}</span>
        {node.element}
      </div>

      <Ancestry node={node} graph={graph} onSelect={onSelect} />

      <div className="section">
        <h3>Identity</h3>
        <table className="attrs">
          <tbody>
            <tr>
              <td className="k">uid</td>
              <td className="v">{node.uid}</td>
            </tr>
            <tr>
              <td className="k">depth</td>
              <td className="v">{node.depth}</td>
            </tr>
            <tr>
              <td className="k">in / out</td>
              <td className="v">
                {inbound.length} / {outbound.length}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {Object.entries(childAttrs).map(([element, rows]) => (
        <div className="section" key={element}>
          <h3>{element}</h3>
          {rows.map((row, i) => (
            <AttrTable key={i} attrs={row} />
          ))}
        </div>
      ))}

      <div className="section">
        <h3>Attributes</h3>
        <AttrTable attrs={node.attrs} />
      </div>

      {outbound.length > 0 && (
        <div className="section">
          <h3>Goes to</h3>
          <table className="attrs">
            <tbody>
              {outbound.map((e, i) => (
                <tr key={i}>
                  <td className="k">{e.label ?? e.reason}</td>
                  <td className="v">
                    <a
                      href="#"
                      style={{ color: 'var(--accent)', textDecoration: 'none' }}
                      onClick={(ev) => {
                        ev.preventDefault();
                        onSelect(e.dst);
                      }}
                    >
                      {graph.nodes.get(e.dst)?.name ?? e.dst}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {snippet !== undefined && (
        <div className="section">
          <h3>Raw XML</h3>
          <pre className="xml">{snippet}</pre>
        </div>
      )}
    </aside>
  );
}
