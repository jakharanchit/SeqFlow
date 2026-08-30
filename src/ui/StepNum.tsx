/**
 * The step number, as it appears in front of a name in every list.
 *
 * One component rather than six copies of a `<span>`: the outline, the search
 * results, the findings, the criteria table, the signal drawer and the diff
 * all show the same rows of steps, and a number that is styled differently in
 * one of them reads as a different kind of thing.
 *
 * Renders nothing for the root, which has no number.
 */
export function StepNum({ number }: { number: string }): React.JSX.Element | null {
  if (number === '') return null;
  return <span className="step-num">{number}</span>;
}
