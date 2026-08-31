/**
 * The schema profiler.
 *
 * Its job is to describe a document the rule file does not cover, so the cases
 * here are synthetic: a real file only proves the profiler agrees with one
 * schema, and the point of the module is the schema nobody has written down
 * yet. Element and attribute names below are nonsense for the same reason.
 *
 * The claim worth testing hardest is the gate. A `when:` clause read wrongly
 * turns a stale attribute into a live edge, which is the one mistake spec 4.2
 * exists to prevent — so the profiler must find a gate when the evidence is
 * there and stay silent when it is not.
 */

import { describe, expect, test } from 'vitest';

import { mergeProfiles, profile, suggestRules, unknowns } from '../src/core/profile';
import { loadRules } from '../src/core/rules';
import type { Rules } from '../src/core/types';
import { domParser, fixtureXml, rules as shipped } from './helpers';

const rules: Rules = loadRules(`
version: 1
containers: [Box]
ignore: [Notes]
steps: [Do]
shapes: {default: rect}
kinds:  {default: action}
edges:
  - when: {onNo: "jump"}
    target: noStep
    reason: branch
`);

const doc = (xml: string): Document => domParser.parseFromString(xml, 'application/xml');

describe('classifying against the rule file', () => {
  const p = profile(
    doc(`<Doc>
      <Box uid="A"><Do uid="A1" name="one"/><Wat uid="A2" name="two"/></Box>
      <Notes><Scribble/></Notes>
    </Doc>`),
    rules,
  );

  test('reports every element name, known or not', () => {
    expect([...p.keys()].sort()).toEqual(['Box', 'Do', 'Doc', 'Notes', 'Scribble', 'Wat']);
  });

  test('uses the rule file’s own vocabulary', () => {
    expect(p.get('Box')?.status).toBe('container');
    expect(p.get('Do')?.status).toBe('step');
    expect(p.get('Notes')?.status).toBe('ignored');
    expect(p.get('Wat')?.status).toBe('unknown');
  });

  test('descends into ignored elements', () => {
    // A rule file that has fallen behind hides things under `ignore:` more
    // often than anywhere else, which is exactly what this report is for.
    expect(p.get('Scribble')?.count).toBe(1);
  });

  test('never proposes ignoring the document element', () => {
    // It carries no uid and holds no steps directly, which is the shape of an
    // ignorable element — but ignoring the root leaves nothing to walk.
    expect(p.get('Doc')?.documentElement).toBe(true);
    expect(unknowns(p).map((e) => e.element)).toEqual(['Wat']);
    expect(suggestRules(p)).not.toContain('Doc');
  });

  test('a rule file with no `steps:` list calls nothing unknown', () => {
    const lenient = loadRules(`
version: 1
containers: [Box]
shapes: {default: rect}
kinds:  {default: action}
edges: [{when: {}, target: goto, reason: goto}]
`);
    expect(unknowns(profile(doc('<Doc><Box uid="A"><Wat uid="B"/></Box></Doc>'), lenient)))
      .toEqual([]);
  });
});

describe('containers found in the file rather than the rules', () => {
  const p = profile(
    doc(`<Doc><Box uid="A">
      <Wat uid="L"><Do uid="L1"/><Do uid="L2"/></Wat>
    </Box></Doc>`),
    rules,
  );

  test('are counted', () => {
    expect(p.get('Wat')?.withStepChildren).toBe(1);
  });

  test('are suggested as containers, not as steps', () => {
    // Getting this the wrong way round is what loses a subtree, so the fragment
    // has to put it under the right key.
    const fragment = suggestRules(p);
    expect(fragment).toMatch(/containers:\n  - Wat/);
    expect(fragment).not.toMatch(/steps:\n(.*\n)*  - Wat/);
  });
});

describe('jump targets, discovered from the values', () => {
  test('an attribute whose value is a uid in this document', () => {
    const p = profile(
      doc(`<Doc><Box uid="A">
        <Do uid="A1" goesTo="A2" colour="red"/>
        <Do uid="A2"/>
      </Box></Doc>`),
      rules,
    );
    expect(p.get('Do')?.targets.map((t) => t.attr)).toEqual(['goesTo']);
  });

  test('an element’s own uid is not a reference to another element', () => {
    const p = profile(doc('<Doc><Box uid="A"><Do uid="A1"/></Box></Doc>'), rules);
    expect(p.get('Do')?.targets).toEqual([]);
  });

  test('finds the gate when the evidence separates live from stale', () => {
    // Three instances: one jumps, two hold a stale value. `act` is the only
    // attribute whose value tells them apart, which is what a `when:` clause is.
    const p = profile(
      doc(`<Doc><Box uid="A">
        <Do uid="A1" act="jump" goesTo="A4" note="x"/>
        <Do uid="A2" act="on"   goesTo="A4" note="y"/>
        <Do uid="A3" act="on"   goesTo="A4" note="z"/>
        <Do uid="A4"/>
      </Box></Doc>`),
      rules,
    );
    const target = p.get('Do')?.targets.find((t) => t.attr === 'goesTo');
    expect(target).toMatchObject({ live: 3, dead: 0 });
    // All three resolve, so there is no stale side to separate — no gate is
    // claimed, and the fragment leaves that rule commented out.
    expect(target?.gate).toBeUndefined();
    expect(suggestRules(p, rules)).toContain('NO GATE FOUND');
  });

  test('claims a gate only when a stale instance disagrees', () => {
    const p = profile(
      doc(`<Doc><Box uid="A">
        <Do uid="A1" act="jump" goesTo="A4"/>
        <Do uid="A2" act="on"   goesTo=""/>
        <Do uid="A3" act="on"   goesTo=""/>
        <Do uid="A4"/>
      </Box></Doc>`),
      rules,
    );
    const target = p.get('Do')?.targets.find((t) => t.attr === 'goesTo');
    expect(target).toMatchObject({ live: 1, dead: 2, gate: { attr: 'act', value: 'jump' } });
    expect(suggestRules(p, rules)).toContain('- when:   {act: "jump"}');
  });

  test('stays silent when the live side does not agree with itself', () => {
    const p = profile(
      doc(`<Doc><Box uid="A">
        <Do uid="A1" act="jump" goesTo="A4"/>
        <Do uid="A2" act="hop"  goesTo="A4"/>
        <Do uid="A3" act="on"   goesTo=""/>
        <Do uid="A4"/>
      </Box></Doc>`),
      rules,
    );
    expect(p.get('Do')?.targets.find((t) => t.attr === 'goesTo')?.gate).toBeUndefined();
  });
});

describe('folding a corpus', () => {
  const a = profile(
    doc(`<Doc><Box uid="A"><Do uid="A1" act="jump" goesTo="A2"/><Do uid="A2" act="on" goesTo=""/></Box></Doc>`),
    rules,
  );
  const b = profile(
    doc(`<Doc><Box uid="B"><Do uid="B1" act="jump" goesTo="B2"/><Do uid="B2" act="on" goesTo=""/></Box></Doc>`),
    rules,
  );
  // The same attribute, gated on a different value.
  const c = profile(
    doc(`<Doc><Box uid="C"><Do uid="C1" act="leap" goesTo="C2"/><Do uid="C2" act="on" goesTo=""/></Box></Doc>`),
    rules,
  );

  test('counts add', () => {
    expect(mergeProfiles([a, b]).get('Do')?.count).toBe(4);
    expect(mergeProfiles([a, b]).get('Do')?.targets[0]).toMatchObject({ live: 2, dead: 2 });
  });

  test('a gate survives only where every file agrees', () => {
    // One file's coincidence is another file's counterexample, and a corpus is
    // the only place that distinction can be drawn.
    expect(mergeProfiles([a, b]).get('Do')?.targets[0]?.gate).toEqual({
      attr: 'act',
      value: 'jump',
    });
    expect(mergeProfiles([a, b, c]).get('Do')?.targets[0]?.gate).toBeUndefined();
  });

  test('merging is not destructive', () => {
    mergeProfiles([a, b]);
    expect(a.get('Do')?.count).toBe(2);
  });
});

describe('the shipped rule file against the shipped fixture', () => {
  test('accounts for everything, and offers nothing to add', () => {
    const p = profile(doc(fixtureXml), shipped);
    expect(unknowns(p)).toEqual([]);
    // Every jump attribute in the file is already a rule, so there is no edge
    // candidate either — the fragment is empty, not merely gap-free.
    expect(suggestRules(p, shipped)).toBe('');
  });

  test('an attribute the rule file already maps is not proposed again', () => {
    const p = profile(
      doc(`<Doc><Box uid="A">
        <Do uid="A1" onNo="jump" noStep="A2"/>
        <Do uid="A2"/>
      </Box></Doc>`),
      rules,
    );
    // `noStep` is the rule file's own target attribute. Reporting it as a
    // discovery would bury the one that is actually new.
    expect(p.get('Do')?.targets.map((t) => t.attr)).toEqual(['noStep']);
    expect(suggestRules(p, rules)).toBe('');
    expect(suggestRules(p)).toContain('noStep');
  });
});
