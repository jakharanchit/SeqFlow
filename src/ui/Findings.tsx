/**
 * Findings tab — Phase 4 task 1's output, given somewhere to be read.
 *
 * The tab sits beside Warnings and never merges with it. A warning means the
 * parser could not make sense of something; a finding means this parsed fine
 * and still looks wrong. Putting 52 findings in the warnings list would make a
 * file with zero warnings look broken, and would bury the four warnings that
 * matter on a file that has them.
 *
 * The right-hand pane is where the "report all eight" instruction is honoured.
 * `ODD_SIBLING_ATTR` fires on the one attribute whose values are provably not
 * parameterisation; selecting it shows the whole difference table for the
 * group, so the reader is never told there is only one thing to look at.
 */

import { useState } from 'react';

import { pathLabel } from '../core/ancestry';
import { StepNum } from './StepNum';
import type { Finding, FindingCode, LintResult } from '../core/lint';
import type { Graph } from '../core/types';

export interface FindingsProps {
  graph: Graph;
  lint: LintResult;
  /** The finding whose detail is shown, by index into `lint.findings`. */
  selected: number | null;
  onSelect: (index: number | null) => void;
  onReveal: (uid: string) => void;
}

const LABELS: Record<FindingCode, string> = {
  ODD_SIBLING_ATTR: 'Odd sibling',
  UNREACHABLE: 'Unreachable',
  MULTIPLE_TERMINALS: 'Ends',
  STALE_TARGET: 'Stale target',
  DUPLICATE_NAME: 'Duplicate name',
  EXTERNAL_CRITERIA: 'External criteria',
};

const ORDER: FindingCode[] = [
  'ODD_SIBLING_ATTR',
  'UNREACHABLE',
  'MULTIPLE_TERMINALS',
  'STALE_TARGET',
  'DUPLICATE_NAME',
  'EXTERNAL_CRITERIA',
];

/** The sibling group a finding came out of, when it came out of one. */
function groupFor(lint: LintResult, finding: Finding) {
  if (finding.code !== 'ODD_SIBLING_ATTR') return null;
  return (
    lint.siblings.find((report) =>
      report.differences.some((d) => d.uids.includes(finding.uid) && d.attr === finding.attr),
    ) ?? null
  );
}

export function Findings({
  graph,
  lint,
  selected,
  onSelect,
  onReveal,
}: FindingsProps): React.JSX.Element {
  const [filter, setFilter] = useState<FindingCode | null>(null);

  const shown = lint.findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => filter === null || finding.code === filter);

  const current = selected === null ? null : (lint.findings[selected] ?? null);
  const group = current === null ? null : groupFor(lint, current);

  return (
    <>
      <div className="drawer-list findings">
        <div className="finding-filters">
          <button
            type="button"
            className={filter === null ? 'on' : ''}
            onClick={() => setFilter(null)}
          >
            All<b>{lint.findings.length}</b>
          </button>
          {ORDER.filter((code) => lint.counts[code] > 0).map((code) => (
            <button
              key={code}
              type="button"
              className={filter === code ? 'on' : ''}
              onClick={() => setFilter(filter === code ? null : code)}
              title={code}
            >
              {LABELS[code]}
              <b>{lint.counts[code]}</b>
            </button>
          ))}
        </div>

        {shown.map(({ finding, index }) => (
          <div
            key={index}
            className={`finding-row sev-${finding.severity}${selected === index ? ' selected' : ''}`}
            role="option"
            aria-selected={selected === index}
            tabIndex={0}
            onClick={() => onSelect(selected === index ? null : index)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(selected === index ? null : index);
              }
            }}
          >
            <code className="finding-code">{LABELS[finding.code]}</code>
            <StepNum number={graph.nodes.get(finding.uid)?.stepNumber ?? ''} />
            <span className="finding-name">
              {graph.nodes.get(finding.uid)?.name || finding.uid}
            </span>
            <span className="detail-path">{pathLabel(graph, finding.uid)}</span>
          </div>
        ))}

        {shown.length === 0 && (
          <p className="hint">
            {lint.findings.length === 0
              ? 'Nothing to report. No odd siblings, no stale jump targets, no duplicated names, one place the flow ends, and every step reachable.'
              : 'No findings of that kind.'}
          </p>
        )}
      </div>

      <div className="drawer-detail">
        {current === null ? (
          <p className="hint">
            Findings are not warnings. Every one of these parsed correctly — the
            sequence still says something worth a second look. Select one to see what.
          </p>
        ) : (
          <div className="finding-detail">
            <p className="finding-message">
              <code className={`finding-code sev-${current.severity}`}>{current.code}</code>{' '}
              {current.message}
            </p>

            {group !== null && (
              <>
                <h4>
                  Every attribute that differs across these {group.group.members.length}{' '}
                  sequences
                </h4>
                <table className="diff">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Attribute</th>
                      {group.names.map((name, i) => (
                        <th key={i}>{name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.differences.map((d, i) => (
                      <tr
                        key={i}
                        className={d.odd ? 'odd-row' : ''}
                        onClick={() => onReveal(d.uids[0] ?? '')}
                      >
                        <td className="diff-step" title={d.element}>
                          {d.label}
                        </td>
                        <td className="diff-attr">
                          {d.attr}
                          <span className="klass">{d.odd ? 'odd' : d.klass}</span>
                        </td>
                        {d.values.map((v, j) => (
                          <td key={j} className="diff-value">
                            {v === '' ? '—' : v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="hint">
                  The seven rows below the first give every sequence its own value, which is
                  what parameterisation looks like. Only the first does not, which is the only
                  thing arithmetic can prove — read the rest yourself.
                </p>
              </>
            )}

            {current.related !== undefined && current.related.length > 1 && (
              <>
                <h4>{current.related.length} steps</h4>
                {current.related.map((uid) => {
                  const node = graph.nodes.get(uid);
                  if (node === undefined) return null;
                  return (
                    <div key={uid} className="detail-row" onClick={() => onReveal(uid)}>
                      <span className={`dot kind-${node.kind}`} />
                      <StepNum number={node.stepNumber} />
                      <span className="detail-name">
                        {node.name === '' ? node.element : node.name}
                      </span>
                      <span className="detail-path">{pathLabel(graph, uid)}</span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
