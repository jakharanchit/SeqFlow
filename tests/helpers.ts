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
 * @xmldom/xmldom stands in for the browser DOMParser under Node. It implements
 * the subset the core uses; the cast bridges the two type declarations.
 */
export const domParser = new DOMParser() as unknown as globalThis.DOMParser;
