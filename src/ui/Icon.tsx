/**
 * The app's icon set: Google Material Symbols, inlined as path data.
 *
 * Path data is taken verbatim from Material Symbols Outlined at weight 400,
 * grade 0, optical size 24 — the default axis values — and is licensed under
 * the Apache License 2.0, like the icons themselves:
 * https://github.com/google/material-design-icons/blob/master/LICENSE
 *
 * Why paths and not the font. Invariant 5 says no network at runtime, and the
 * build inlines everything into one `.html` served from `file://`, so the
 * usual `<link>` to fonts.googleapis.com is not available. The two remaining
 * options were a vendored `.woff2` and this. A font would have to be
 * subsetted to stay off the bundle's size, which puts a `pyftsubset` step
 * between "add an icon" and "see the icon" — a build step that has to be
 * re-run correctly by whoever next touches the UI, and that fails silently
 * into a tofu box when they don't. Fifteen path strings cost about 3 KB and
 * have no such step: adding an icon is pasting one line into the table below.
 *
 * Every glyph shares Material Symbols' own `0 -960 960 960` viewBox, and every
 * one is drawn at `1em` in `currentColor`. That is the whole reason this file
 * needs no per-call-site sizing: an icon inherits the font size and the colour
 * of whatever control it sits in, so it tracks the outline's four text sizes
 * and both sides of the theme without knowing either exists.
 */

const PATHS = {
  add: 'M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z',
  account_tree:
    'M600-120v-120H440v-400h-80v120H80v-320h280v120h240v-120h280v320H600v-120h-80v320h80v-120h280v320H600ZM160-760v160-160Zm520 400v160-160Zm0-400v160-160Zm0 160h120v-160H680v160Zm0 400h120v-160H680v160ZM160-600h120v-160H160v160Z',
  check: 'M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z',
  chevron_right: 'M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z',
  close:
    'm256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z',
  expand_more: 'M480-345 240-585l56-56 184 184 184-184 56 56-240 240Z',
  fit_screen:
    'M800-600v-120H680v-80h120q33 0 56.5 23.5T880-720v120h-80Zm-720 0v-120q0-33 23.5-56.5T160-800h120v80H160v120H80Zm600 440v-80h120v-120h80v120q0 33-23.5 56.5T800-160H680Zm-520 0q-33 0-56.5-23.5T80-240v-120h80v120h120v80H160Zm80-160v-320h480v320H240Zm80-80h320v-160H320v160Zm0 0v-160 160Z',
  map: 'm600-120-240-84-186 72q-20 8-37-4.5T120-170v-560q0-13 7.5-23t20.5-15l212-72 240 84 186-72q20-8 37 4.5t17 33.5v560q0 13-7.5 23T812-192l-212 72Zm-40-98v-468l-160-56v468l160 56Zm80 0 120-40v-474l-120 46v468Zm-440-10 120-46v-468l-120 40v474Zm440-458v468-468Zm-320-56v468-468Z',
  remove: 'M200-440v-80h560v80H200Z',
  schema:
    'M160-40v-240h100v-80H160v-240h100v-80H160v-240h280v240H340v80h100v80h120v-80h280v240H560v-80H440v80H340v80h100v240H160Zm80-80h120v-80H240v80Zm0-320h120v-80H240v80Zm400 0h120v-80H640v80ZM240-760h120v-80H240v80Zm60-40Zm0 320Zm400 0ZM300-160Z',
  settings:
    'm370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z',
  text_decrease:
    'm40-200 210-560h100l210 560h-96l-51-143H187l-51 143H40Zm176-224h168l-82-232h-4l-82 232Zm384-16v-80h320v80H600Z',
  text_increase:
    'm40-200 210-560h100l210 560h-96l-51-143H187l-51 143H40Zm176-224h168l-82-232h-4l-82 232Zm504 104v-120H600v-80h120v-120h80v120h120v80H800v120h-80Z',
  vertical_split:
    'M120-360v-80h320v80H120Zm0 160v-80h320v80H120Zm0-320v-80h320v80H120Zm0-160v-80h320v80H120Zm480 480q-33 0-56.5-23.5T520-280v-400q0-33 23.5-56.5T600-760h160q33 0 56.5 23.5T840-680v400q0 33-23.5 56.5T760-200H600Zm0-80h160v-400H600v400Zm80-200Z',
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps {
  name: IconName;
  /**
   * Only for an icon that is the *whole* of a control's content and whose
   * meaning is not already carried by an `aria-label` or adjacent text.
   * Left off, the icon is `aria-hidden` — the right default, since almost
   * every call site here sits inside a button that already names itself.
   */
  label?: string;
  className?: string;
}

export function Icon({ name, label, className }: IconProps): React.JSX.Element {
  return (
    <svg
      className={className === undefined ? 'icon' : `icon ${className}`}
      viewBox="0 -960 960 960"
      width="1em"
      height="1em"
      fill="currentColor"
      role={label === undefined ? undefined : 'img'}
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
