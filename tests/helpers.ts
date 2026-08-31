import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';

import { loadRules } from '../src/core/rules';
import type { Rules } from '../src/core/types';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '..');

export function read(...parts: string[]): string {
  return readFileSync(join(repoRoot, ...parts), 'utf8');
}

export const rules: Rules = loadRules(read('rules.yaml'));
export const fixtureXml = read('fixtures', 'Sequence_XML.xml');

/**
 * The second dialect: a gas-analyzer integration test from a different product
 * line, wrapped in a <TestSpecification> the battery fixture does not have and
 * built around a repeating container it does not use.
 *
 * There is exactly one of these, and there should stay exactly one. Golden
 * fixtures pin parser *semantics*, which needs one file per document shape —
 * not one per file. Checking a corpus in is the failure mode this avoids; the
 * corpus is checked by `--audit`, over a directory named at runtime.
 */
export const gasXml = read('fixtures', 'GasAnalyzer_XML.xml');

/**
 * @xmldom/xmldom stands in for the browser DOMParser under Node. It implements
 * the subset the core uses; the cast bridges the two type declarations.
 */
export const domParser = new DOMParser() as unknown as globalThis.DOMParser;
