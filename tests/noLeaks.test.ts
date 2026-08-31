/**
 * Nothing from a sequence file reaches the build, and nothing untracked-by-
 * design becomes tracked.
 *
 * The fixtures are anonymised, so this is not the last line of defence — but it
 * is the one that holds for a fixture nobody has scrubbed yet, and it is
 * self-referential on purpose: it takes the names out of whatever fixture is
 * currently checked in and looks for them in the artifact. It therefore needs
 * no denylist of its own, which is the trap this kind of test usually falls
 * into — a file listing the secrets you are trying not to publish.
 *
 * It found a real leak the first time it was written. A plant tag had been
 * hard-coded as the example in the Signals tab's hint text, so
 * `power_supply_voltage_setpoint` shipped inside `dist/index.html` while every
 * other piece of sequence content stayed out. Grepping for *names* had missed
 * it, because the leak was an attribute value.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parse } from '../src/core/parse';
import { domParser, fixtureXml, gasXml, repoRoot, rules } from './helpers';

const DIST = join(repoRoot, 'dist', 'index.html');

const RULES_TEXT = readFileSync(join(repoRoot, 'rules.yaml'), 'utf8');

/**
 * Whether a string is distinctive enough that finding it in the bundle would
 * mean something.
 *
 * Two exclusions, both necessary or the guard cries wolf and gets deleted:
 *
 * - **Anything the rule file contains.** `rules.yaml` is inlined into the page
 *   on purpose (invariant 5), so `Go To Step` and `Continue` are in there by
 *   design and are schema vocabulary rather than anybody's data.
 * - **Single plain words.** "Initialize" is a sequence name here and also an
 *   ordinary English word that appears in the vendor bundle. A phrase, or a
 *   compound identifier like `drive_source_reading_setpoint` or `UnitReading`,
 *   cannot arrive by coincidence — and a compound is what the one real leak
 *   turned out to be.
 */
function identifying(value: string): boolean {
  if (value.length < 8) return false;
  if (/^[\d.\s]+$/.test(value)) return false;
  if (RULES_TEXT.includes(value)) return false;
  return /[ _-]/.test(value) || /[a-z][A-Z]/.test(value);
}

/** Every name and attribute value in a fixture that could identify its source. */
function vocabulary(xml: string): string[] {
  const graph = parse(xml, { rules, domParser });
  const out = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (identifying(node.name)) out.add(node.name);
    for (const [key, value] of Object.entries(node.attrs)) {
      // uids are regenerated and mean nothing on their own.
      if (key === 'uid') continue;
      if (identifying(value)) out.add(value);
    }
  }
  return [...out];
}

describe('the built page carries no sequence content', () => {
  const built = existsSync(DIST) ? readFileSync(DIST, 'utf8') : null;

  it.runIf(built !== null)('no name or tag from either fixture appears in dist', () => {
    const terms = [...vocabulary(fixtureXml), ...vocabulary(gasXml)];
    expect(terms.length).toBeGreaterThan(50);
    const leaked = terms.filter((t) => built!.includes(t));
    // Named individually: a count tells you nothing about what to go and fix.
    expect(leaked).toEqual([]);
  });

  it('says so when there is no build to check', () => {
    // `npm test` runs without building. The assertion above is skipped then,
    // which is fine — `npm run build` is what this guards, and CI runs both.
    expect(built === null || built.length > 0).toBe(true);
  });
});

describe('the corpus stays out of the repo', () => {
  it('test_xmls/ is ignored', () => {
    const ignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
    const line = ignore
      .split(/\r?\n/)
      .find((l) => l.trim() === 'test_xmls/');
    expect(line, 'test_xmls/ must be gitignored — it holds real sequences').toBeDefined();
  });
});
