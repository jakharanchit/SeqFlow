/**
 * Getting bytes out of the page.
 *
 * Both routes are deliberately primitive. A `Blob` and an `<a download>` work
 * from a `file://` page, which is how this ships (NFR-3), and neither touches
 * the network (NFR-2, invariant 5). `navigator.clipboard.writeText` needs no
 * permission for a write inside a user gesture.
 *
 * Nothing here writes to disk on its own — the browser does, where the user
 * points it. Invariant 4 is untouched: no sequence XML is ever produced.
 */

/** Offer `text` to the user as a file. Resolves once the click has been made. */
export function downloadText(name: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  // Firefox needs the anchor in the document before the click counts.
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately races the download in some browsers; a frame is
  // enough and the object is small.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * True on success. The caller shows the result; it never throws.
 *
 * Two routes, because one is not enough. `navigator.clipboard` needs a secure
 * context, and this ships as a `file://` page (NFR-3) — Chrome treats that as
 * trustworthy, Firefox does not, and an embedded webview may refuse it
 * outright. The `execCommand` fallback is deprecated and works everywhere.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
}

/** Select-and-copy through a throwaway textarea. No permission, no context. */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  // Off-screen rather than hidden: `display:none` cannot hold a selection.
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/** `Sequence_XML.xml` -> `Sequence_XML`. Used to name every export. */
export function stem(fileName: string): string {
  const cut = fileName.lastIndexOf('.');
  const base = cut <= 0 ? fileName : fileName.slice(0, cut);
  return base === '' ? 'sequence' : base;
}
