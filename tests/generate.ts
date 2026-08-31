/**
 * A synthetic sequence of any size.
 *
 * This is the one place in the repo where a generated file is exactly the right
 * input. Everywhere else a synthetic fixture tests only what we already
 * believed — but a *performance* question is about size and shape, not about
 * meaning, and generating the input is the only way to ask it at 5 000 nodes
 * without holding 5 000 nodes of somebody's test programme.
 *
 * It is built to stress the things that actually cost, not to look plausible:
 *
 *   - **Depth**, because ELK lays out hierarchically and nesting is what makes
 *     that expensive.
 *   - **Convergence**, because the fixture's sharpest number is 16 edges
 *     arriving at one node, and a shared abort target is what produces it.
 *   - **Branches and back edges**, because a straight chain is the easy case
 *     for every walk in `core/`, and a corpus is not straight chains.
 *
 * Element and attribute names come from the shipped `rules.yaml` vocabulary so
 * the generated file parses with zero warnings — a benchmark that spends its
 * time in the warning path is measuring the wrong thing.
 */

/** Deterministic, so two runs of the benchmark measure the same graph. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** A uid-shaped identifier. Not a real GUID and does not need to be. */
function uid(n: number): string {
  const hex = n.toString(16).padStart(12, '0').toUpperCase();
  return `00000000-0000-4000-8000-${hex}`;
}

export interface GenerateOptions {
  /** Roughly how many leaf steps to produce. */
  leaves: number;
  /** Leaves per innermost sequence. */
  perGroup?: number;
  /** Sequences per outer sequence — the branching factor of the tree. */
  fanOut?: number;
  seed?: number;
}

export interface Generated {
  xml: string;
  /** What the parser should find. Asserted by the benchmark as a sanity check. */
  expectedNodes: number;
  expectedLeaves: number;
}

/**
 * Build the XML.
 *
 * The shape is a two-level tree — outer sequences holding inner ones — with a
 * single shared abort target at the end that a criteria step in every inner
 * group jumps to. That last part is deliberate: it is what gives the graph a
 * high-convergence node, which is where layout and the path walks get
 * interesting.
 */
export function generateSequence(opts: GenerateOptions): Generated {
  const perGroup = opts.perGroup ?? 8;
  const fanOut = opts.fanOut ?? 6;
  const random = rng(opts.seed ?? 1);

  const groups = Math.max(1, Math.ceil(opts.leaves / perGroup));
  const outers = Math.max(1, Math.ceil(groups / fanOut));

  let counter = 0;
  const next = (): string => uid(++counter);

  // Reserved first, because every criteria step jumps to it and a jump target
  // has to exist before the step that names it is written.
  const abortUid = next();

  const lines: string[] = [];
  let leaves = 0;
  let containers = 0;

  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>');
  lines.push('<TestSpecification>');
  lines.push('<TestSequence>');
  lines.push('<Variables/>');
  lines.push(`<Sequence name="Generated" timeoutSeconds="0" uid="${next()}">`);
  containers++;

  let made = 0;
  for (let o = 0; o < outers && made < groups; o++) {
    lines.push(`<Sequence name="Block ${o + 1}" timeoutSeconds="0" uid="${next()}">`);
    containers++;

    for (let g = 0; g < fanOut && made < groups; g++, made++) {
      // Every third inner group repeats, so loop back edges are represented.
      const loops = made % 3 === 2;
      const tag = loops ? 'Loop' : 'Sequence';
      const extra = loops ? ` iterations="${2 + (made % 5)}" period="${60 * (1 + (made % 4))}"` : '';
      lines.push(`<${tag} name="Step Group ${made + 1}"${extra} timeoutSeconds="0" uid="${next()}">`);
      containers++;

      for (let i = 0; i < perGroup; i++) {
        const u = next();
        leaves++;
        const roll = random();
        if (i === perGroup - 1) {
          // One criteria step per group, all diverting to the same abort. This
          // is what builds the convergent node.
          lines.push(
            `<TestCriteriaEvaluation name="Check ${made + 1}" criteriaMap="${uid(900000 + made)}"` +
              ` passAction="Continue" passStep="" failAction="Go To Step" failStep="${abortUid}"` +
              ` timeoutSeconds="0" uid="${u}"/>`,
          );
        } else if (roll < 0.12) {
          lines.push(
            `<ConditionStep name="Decide ${made + 1}.${i + 1}" trueAction="Continue" trueStep=""` +
              ` falseAction="Continue" falseStep="" checkPeriod="0" timeoutSeconds="0" uid="${u}">` +
              `<Comparison sensorTag="signal_${made % 17}" comparison="GreaterThan" value="${(roll * 100).toFixed(1)}"/>` +
              '</ConditionStep>',
          );
        } else if (roll < 0.5) {
          lines.push(
            `<WaitStep name="Wait ${made + 1}.${i + 1}" time="${1 + Math.floor(roll * 20)}"` +
              ` waitType="Wait For" timeoutSeconds="0" uid="${u}"/>`,
          );
        } else {
          lines.push(
            `<SetSetpoint name="Set ${made + 1}.${i + 1}" setpointTag="signal_${made % 17}"` +
              ` setpoint="${(roll * 24).toFixed(2)}" timeoutSeconds="0" uid="${u}"/>`,
          );
        }
      }
      lines.push(`</${tag}>`);
    }
    lines.push('</Sequence>');
  }

  // The shared abort target, last, so the flow can fall into it as well as jump.
  lines.push(`<Sequence name="Abort" timeoutSeconds="0" uid="${next()}">`);
  containers++;
  lines.push(`<SetStatus name="Abort" status="Failed" tag="test_status" timeoutSeconds="0" uid="${abortUid}"/>`);
  leaves++;
  lines.push('</Sequence>');

  lines.push('</Sequence>');
  lines.push('</TestSequence>');
  lines.push('</TestSpecification>');

  return {
    xml: lines.join(''),
    expectedNodes: leaves + containers,
    expectedLeaves: leaves,
  };
}
