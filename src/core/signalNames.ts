/**
 * An optional dictionary of human names for signal tags and enum values.
 *
 * The authoring tool's text export prints `Pack Temp max` where the XML says
 * `calc_mod_unit_temp_max`, and `Drive Source Reading Request` where it says
 * `drive_source_reading_setpoint`. No transform gets from one to the other:
 * "Request" is not a rendering of "setpoint", it is a different word chosen by
 * whoever named the signal. The names live in a dictionary outside the file.
 *
 * So this module loads one when the user has it, and does nothing when they do
 * not. **With no dictionary loaded, every tag is shown exactly as the XML
 * spells it.** Guessing — title-casing `drive_source_reading_setpoint` into
 * "Power Supply Voltage Setpoint" — would be right about half the time and
 * silently wrong the rest, which is the one outcome a read-only tool used in a
 * regulated context cannot afford.
 *
 * Deliberately not wired into the Mermaid or SVG exports. A label that depends
 * on a file outside the XML would make the CLI's `--check` depend on it too,
 * and `--signals` does not exist. The dictionary is a reading aid in the app;
 * exports stay a function of the sequence file alone.
 *
 * Pure: parsing text, no I/O. The UI reads the file and hands over a string.
 */

/** Tag -> human name, and `tag:value` -> human label for an enum member. */
export type SignalNames = ReadonlyMap<string, string>;

export interface SignalNameFile {
  names: SignalNames;
  /** Rows that carried no second column, or repeated a key. For the UI. */
  skipped: number;
  /** Distinct keys loaded. */
  size: number;
}

const EMPTY: SignalNameFile = { names: new Map(), skipped: 0, size: 0 };

/** Nothing loaded. A shared value so callers need no null check. */
export function noSignalNames(): SignalNameFile {
  return EMPTY;
}

/**
 * Split one CSV or TSV row. Tab wins where a line holds both, because a tab is
 * never part of a tag and a comma can be part of a name ("Pack Temp, max").
 * Quoted fields are honoured for the same reason.
 */
function fields(line: string): string[] {
  if (line.includes('\t')) return line.split('\t');

  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

/**
 * Two columns: the tag as the XML spells it, then the human name. Blank lines
 * and `#` comments are skipped, and so is a leading header row naming its own
 * columns — spreadsheets add one whether or not anybody asked.
 *
 * An enum member is keyed `tag:value`, e.g.
 * `controlled_load_operation_mode:2, 2: Constant Current`.
 *
 * The first spelling of a key wins. A file that names one tag twice is telling
 * us something is wrong with it, and the count of skipped rows says so rather
 * than the second row quietly overwriting the first.
 */
export function parseSignalNames(text: string): SignalNameFile {
  const names = new Map<string, string>();
  let skipped = 0;
  let first = true;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const cells = fields(line).map((c) => c.trim());
    const key = cells[0] ?? '';
    const value = cells[1] ?? '';

    if (first) {
      first = false;
      // A header names its columns; it does not name a signal.
      if (/^(tag|signal|name|key)$/i.test(key)) continue;
    }

    if (key === '' || value === '') {
      skipped++;
      continue;
    }
    if (names.has(key)) {
      skipped++;
      continue;
    }
    names.set(key, value);
  }

  return { names, skipped, size: names.size };
}

/**
 * The human name for a tag, or the tag itself. Never a derived one.
 *
 * Callers pass this straight to the DOM, so a missing dictionary degrades to
 * exactly today's behaviour with no branch at the call site.
 */
export function signalLabel(tag: string, names?: SignalNames): string {
  return names?.get(tag) ?? tag;
}

/** The label for an enum member — `tag:value`, falling back to the value. */
export function enumLabel(tag: string, value: string, names?: SignalNames): string {
  return names?.get(`${tag}:${value}`) ?? value;
}

/**
 * Tags in the file that the dictionary does not name. Shown in the drawer so a
 * half-complete dictionary reads as half-complete rather than as a file whose
 * signals happen to be spelled in two styles.
 */
export function unnamedTags(tags: Iterable<string>, names?: SignalNames): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    if (names?.has(tag) !== true) out.push(tag);
  }
  return out.sort();
}
