/**
 * Left pane: search, type filter, and the sequence tree.
 *
 * The primary navigation surface, and the UI for the collapse model. Selection
 * is one uid in app state with three views of it — outline, canvas, inspector —
 * so a click here is the same event as a click on the canvas.
 *
 * When a query is active the tree gives way to a result list, because a result
 * needs its parent path beside it and the tree cannot show that in a row. 27
 * names cover 106 of the 133 nodes in the sample: a bare name is not an answer.
 *
 * All 133 rows render at once. Virtualising them would be premature — the whole
 * file is one flat list of small divs, and collapsing four sequences takes it
 * to 21.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { displayName, numberedName } from '../core/ancestry';
import { StepNum } from './StepNum';
import type { ElementCount, SearchResult } from '../core/search';
import type { Graph, SeqNode } from '../core/types';

export interface OutlineProps {
  graph: Graph | null;
  selected: string | null;
  collapsed: ReadonlySet<string>;
  onSelect: (uid: string) => void;
  onToggle: (uid: string) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;

  /* Search and filter. */
  text: string;
  onTextChange: (text: string) => void;
  elements: ReadonlySet<string>;
  onElementsChange: (elements: ReadonlySet<string>) => void;
  available: ElementCount[];
  results: SearchResult[];
  searching: boolean;
}

interface Row {
  node: SeqNode;
  /** Indent level within the outline, not the parse depth. */
  level: number;
  isContainer: boolean;
  childCount: number;
}

/**
 * Rows in document order, skipping the subtrees of collapsed sequences. The
 * collapsed sequence itself stays — it is how you expand it again.
 */
function rowsFor(graph: Graph, collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();

  const visit = (uid: string, level: number): void => {
    if (seen.has(uid)) return;
    seen.add(uid);
    const node = graph.nodes.get(uid);
    if (node === undefined) return;

    const children = graph.containers.get(uid);
    rows.push({
      node,
      level,
      isContainer: children !== undefined,
      childCount: children?.length ?? 0,
    });
    if (children === undefined || collapsed.has(uid)) return;
    for (const child of children) visit(child, level + 1);
  };

  for (const node of graph.nodes.values()) {
    if (node.parent === null) visit(node.uid, 0);
  }
  return rows;
}

/** Total nodes beneath a container, at any depth. */
function subtreeSize(graph: Graph, uid: string): number {
  let total = 0;
  const stack = [...(graph.containers.get(uid) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    total++;
    stack.push(...(graph.containers.get(next) ?? []));
  }
  return total;
}

/** The matched run of the name, marked so the eye lands on it. */
function Marked({ name, at, length }: { name: string; at: number; length: number }): React.JSX.Element {
  if (at < 0 || length === 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, at)}
      <mark>{name.slice(at, at + length)}</mark>
      {name.slice(at + length)}
    </>
  );
}

/**
 * Row height in pixels. **Must match `.outline .row { height }` in styles.css** —
 * the windowing below places rows by arithmetic, not by measuring them, and a
 * disagreement shows up as rows drifting out of the scroll position.
 */
const ROW_HEIGHT = 22;

/**
 * Rows to render beyond the visible slice, above and below. Enough that a fast
 * scroll does not reach the edge before the next render lands.
 */
const OVERSCAN = 12;

/**
 * Below this, every row is rendered and the window is not used at all.
 *
 * A 133-row outline has never been the problem; a corpus has sequences several
 * times that, and 5 733 rows is 5 733 DOM subtrees that re-render on every
 * selection. Keeping the small case unwindowed means the common path has no
 * spacers in it and nothing to get wrong.
 */
const WINDOW_ABOVE = 200;

export function Outline({
  graph,
  selected,
  collapsed,
  onSelect,
  onToggle,
  onCollapseAll,
  onExpandAll,
  text,
  onTextChange,
  elements,
  onElementsChange,
  available,
  results,
  searching,
}: OutlineProps): React.JSX.Element {
  const rows = useMemo(
    () => (graph === null ? [] : rowsFor(graph, collapsed)),
    [graph, collapsed],
  );
  // The type chips are a dozen rows of vertical space that most sessions never
  // touch, so they stay folded until asked for.
  const [showFilters, setShowFilters] = useState(false);

  const sizes = useMemo(() => {
    const out = new Map<string, number>();
    if (graph === null) return out;
    for (const uid of graph.containers.keys()) out.set(uid, subtreeSize(graph, uid));
    return out;
  }, [graph]);

  /* ---------------------------------------------------------------- */
  /* Windowing                                                         */
  /* ---------------------------------------------------------------- */

  const scroller = useRef<HTMLDivElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  /**
   * A callback ref, not an effect.
   *
   * The rows container is not mounted with the component — there is no file
   * yet, and the search results replace it when the box has a query — so an
   * effect that looks for it once on mount finds nothing, never runs again,
   * and leaves the viewport height at zero. Windowing is off while that is
   * zero, so the failure is silent: every row renders and the whole feature
   * quietly does not exist. A callback ref fires on each mount and unmount.
   */
  const attach = useCallback((el: HTMLDivElement | null): void => {
    observer.current?.disconnect();
    scroller.current = el;
    if (el === null) {
      observer.current = null;
      return;
    }
    setViewport(el.clientHeight);
    setScrollTop(el.scrollTop);
    observer.current = new ResizeObserver(() => setViewport(el.clientHeight));
    observer.current.observe(el);
  }, []);

  const windowed = rows.length > WINDOW_ABOVE && viewport > 0;
  const first = windowed
    ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    : 0;
  const last = windowed
    ? Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
    : rows.length;
  const slice = windowed ? rows.slice(first, last) : rows;

  /*
   * Bring the selected row into view.
   *
   * Without windowing an off-screen selection was merely out of sight; with it
   * the row is not in the DOM at all, so a canvas or search selection could
   * leave the outline showing nothing related. Scrolls only when the row is
   * outside the viewport, so clicking down the list does not fight the reader.
   */
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el === null || selected === null) return;
    const index = rows.findIndex((r) => r.node.uid === selected);
    if (index < 0) return;
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    }
  }, [selected, rows]);

  if (graph === null) {
    return (
      <aside className="outline">
        <p className="hint">No file loaded.</p>
      </aside>
    );
  }

  const needle = text.trim();

  const toggleElement = (element: string): void => {
    const next = new Set(elements);
    if (!next.delete(element)) next.add(element);
    onElementsChange(next);
  };

  return (
    <aside className="outline">
      <div className="outline-head">
        <span>Outline</span>
        <div className="outline-actions">
          <button type="button" onClick={onCollapseAll} title="Collapse every sequence">
            Collapse all
          </button>
          <button type="button" onClick={onExpandAll} title="Expand every sequence">
            Expand all
          </button>
        </div>
      </div>

      <div className="outline-search">
        <div className="search-line">
          <input
            type="search"
            value={text}
            placeholder="Search names or a step number…"
            aria-label="Search step names"
            onChange={(e) => onTextChange(e.target.value)}
          />
          {searching && (
            <button
              type="button"
              className="clear"
              title="Clear search and filter"
              onClick={() => {
                onTextChange('');
                onElementsChange(new Set());
              }}
            >
              ×
            </button>
          )}
        </div>

        <button
          type="button"
          className="filters-toggle"
          aria-expanded={showFilters || elements.size > 0}
          onClick={() => setShowFilters((v) => !v)}
        >
          <span className="twisty-inline">{showFilters || elements.size > 0 ? '▾' : '▸'}</span>
          Filter by type
          {elements.size > 0 && <b>{elements.size}</b>}
        </button>

        {(showFilters || elements.size > 0) && (
          <div className="chips">
            {available.map(({ element, count }) => (
              <button
                key={element}
                type="button"
                className={`filter-chip${elements.has(element) ? ' on' : ''}`}
                aria-pressed={elements.has(element)}
                title={`${count} ${element} node${count === 1 ? '' : 's'}`}
                onClick={() => toggleElement(element)}
              >
                {element}
                <b>{count}</b>
              </button>
            ))}
          </div>
        )}
      </div>

      {searching ? (
        <>
          <div className="result-count">
            {results.length} match{results.length === 1 ? '' : 'es'}
          </div>
          <div className="outline-rows">
            {results.map((r) => (
              <div
                key={r.uid}
                className={`result${selected === r.uid ? ' selected' : ''}`}
                onClick={() => onSelect(r.uid)}
                role="option"
                aria-selected={selected === r.uid}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(r.uid);
                  }
                }}
              >
                <div className="result-name">
                  <span className={`dot kind-${r.kind}`} />
                  <StepNum number={r.stepNumber} />
                  <Marked name={r.name} at={r.at} length={needle.length} />
                </div>
                {/* The path is what disambiguates five "Turn off Load"s. */}
                <div className="result-path" title={r.path}>
                  {r.path === '' ? r.element : r.path}
                </div>
              </div>
            ))}
            {results.length === 0 && <p className="hint">Nothing matches.</p>}
          </div>
        </>
      ) : (
        <div
          className="outline-rows"
          ref={attach}
          onScroll={(e) => {
            if (windowed) setScrollTop(e.currentTarget.scrollTop);
          }}
        >
          {/* Spacers stand in for the rows above and below the window, so the
              scrollbar reflects the whole tree rather than the rendered slice. */}
          {first > 0 && <div style={{ height: first * ROW_HEIGHT }} />}
          {slice.map(({ node, level, isContainer, childCount }) => {
            const isCollapsed = collapsed.has(node.uid);
            return (
              <div
                key={node.uid}
                className={[
                  'row',
                  selected === node.uid ? 'selected' : '',
                  isContainer ? 'is-container' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ paddingLeft: 6 + level * 13 }}
                onClick={() => onSelect(node.uid)}
                role="treeitem"
                aria-selected={selected === node.uid}
                aria-expanded={isContainer ? !isCollapsed : undefined}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(node.uid);
                  }
                }}
              >
                {isContainer ? (
                  <button
                    type="button"
                    className="twisty"
                    aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                    title={isCollapsed ? 'Expand' : 'Collapse'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(node.uid);
                    }}
                  >
                    {isCollapsed ? '▸' : '▾'}
                  </button>
                ) : (
                  <span className={`dot kind-${node.kind}`} />
                )}

                <StepNum number={node.stepNumber} />
                <span
                  className="row-name"
                  title={`${node.element} — ${numberedName(node)}`}
                >
                  {displayName(node)}
                </span>

                {isContainer && (
                  <span className="row-count">
                    {isCollapsed ? (sizes.get(node.uid) ?? childCount) : childCount}
                  </span>
                )}
              </div>
            );
          })}
          {last < rows.length && <div style={{ height: (rows.length - last) * ROW_HEIGHT }} />}
        </div>
      )}
    </aside>
  );
}
