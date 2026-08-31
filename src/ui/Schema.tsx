/**
 * Schema tab — what this file contains that the rule file has no answer for.
 *
 * The Warnings tab reports the parser's difficulties one element at a time, in
 * document order, which is the right shape for a file the tool already
 * understands. This is the other shape: one row per *element name*, sorted by
 * how often it occurs, and a paste-ready `rules.yaml` fragment underneath.
 *
 * It exists because the first unfamiliar dialect produced fourteen warnings
 * saying four things, and the useful reply to that is not fourteen lines — it
 * is four lines of YAML.
 *
 * The table renders whether or not there are gaps: a file with none is worth
 * showing too, because it says the rule file is current for this dialect.
 */

import { suggestRules, unknowns, type SchemaProfile } from '../core/profile';
import type { Rules } from '../core/types';
import { copyText } from './download';

export interface SchemaProps {
  profile: SchemaProfile;
  /** The rule file in force — a target it already maps is not proposed again. */
  rules: Rules;
  fileName: string;
}

export function Schema({ profile, rules, fileName }: SchemaProps): React.JSX.Element {
  const rows = [...profile.values()].sort(
    (a, b) => b.count - a.count || (a.element < b.element ? -1 : 1),
  );
  const gaps = unknowns(profile);
  const fragment = suggestRules(profile, rules);

  return (
    <div className="drawer-list wide schema">
      <p className="hint">
        Every element in <b>{fileName}</b>, against what the rule file knows.{' '}
        {gaps.length === 0 ? (
          <>
            Nothing is unaccounted for — the rule file is current for this dialect.
          </>
        ) : (
          <>
            <b>
              {gaps.length} {gaps.length === 1 ? 'element has' : 'elements have'} no entry.
            </b>{' '}
            Add them to <code>rules.yaml</code> and drop it on the page; nothing needs
            rebuilding.
          </>
        )}
      </p>

      <table className="attrs schema-table">
        <thead>
          <tr>
            <th>element</th>
            <th className="num">count</th>
            <th>rule file says</th>
            <th>in the file</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            // An element the rules call a leaf while the file nests steps in it
            // is the one disagreement that costs a subtree if left alone.
            const mismatch = r.withStepChildren > 0 && r.status !== 'container';
            return (
              <tr key={r.element} className={mismatch ? 'bad' : r.status === 'unknown' ? 'odd' : ''}>
                <td className="k">
                  <code>{r.element}</code>
                </td>
                <td className="num">{r.count}</td>
                <td className="v">
                  {r.documentElement && r.status === 'unknown' ? 'document element' : r.status}
                </td>
                <td className="v">
                  {mismatch && (
                    <b>
                      holds steps in {r.withStepChildren} — belongs in <code>containers</code>.{' '}
                    </b>
                  )}
                  {r.withUid === 0 && r.count > 0 && !r.documentElement && 'never carries a uid. '}
                  {r.targets.length > 0 && (
                    <>
                      targets:{' '}
                      {r.targets.map((t) => (
                        <code key={t.attr} title={`${t.live} live, ${t.dead} stale`}>
                          {t.attr}
                          {t.gate !== undefined && ` when ${t.gate.attr}=${t.gate.value}`}{' '}
                        </code>
                      ))}
                    </>
                  )}
                  {r.samples.length > 0 && <span className="hint"> e.g. “{r.samples[0]}”</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {fragment !== '' && (
        <>
          <div className="schema-actions">
            <h4>Starter rules.yaml fragment</h4>
            <button type="button" onClick={() => void copyText(fragment)}>
              Copy
            </button>
          </div>
          <p className="hint">
            A fragment, not a file — merge it into the rule file you already have. Any edge rule
            without a discovered <code>when:</code> is commented out on purpose: an ungated target
            attribute holds a stale value whenever its paired action is not a jump, and reading
            one is the mistake spec 4.2 exists to prevent.
          </p>
          <pre className="schema-fragment">{fragment}</pre>
        </>
      )}
    </div>
  );
}
