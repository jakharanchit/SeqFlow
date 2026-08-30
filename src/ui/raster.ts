/**
 * SVG -> PNG. Phase 3 task 5.
 *
 * The rasteriser is the browser's own: an `Image` fed a data URI of the SVG,
 * drawn into a `canvas`, read back as a blob. No dependency, no network, and
 * it works from a `file://` page — a *data* URI does not taint the canvas, so
 * `toBlob` stays readable. Fetching the same SVG over `blob:` would not, in
 * some browsers, which is why the data URI is not an accident.
 *
 * Sizing is the trap this task named. Grouped is 975 x 8886, so a 2x export is
 * 1950 x 17772 — 34.6 Mpx, inside every browser's limits but a PNG no document
 * wants. The caller shows the pixel dimensions before the click; this function
 * refuses anything past `MAX_PIXELS` rather than handing back a blank canvas,
 * which is what a browser does when it runs out of room.
 *
 * Rendering and saving are two clicks, deliberately. Rasterising the grouped
 * layout takes over a second, and an `<a download>` click that late has
 * outlived its user activation — the browser drops it in silence, which is the
 * worst outcome available. `downloadBlob` runs inside the second click, with
 * the blob already in hand, so it is synchronous and always lands.
 */

/**
 * Chrome caps a canvas at 268 Mpx and Safari far lower; 120 Mpx is the point
 * past which the PNG is unusable anyway.
 */
export const MAX_PIXELS = 120_000_000;

export interface RasterResult {
  blob: Blob;
  width: number;
  height: number;
}

export class RasterError extends Error {}

export async function svgToPng(
  svg: string,
  width: number,
  height: number,
  scale = 1,
): Promise<RasterResult> {
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  if (w <= 0 || h <= 0) throw new RasterError('nothing to export');
  if (w * h > MAX_PIXELS) {
    throw new RasterError(
      `${w} x ${h} is ${Math.round((w * h) / 1e6)} Mpx, past what a browser canvas will hold. Try 1x, or the compact layout.`,
    );
  }

  const image = new Image();
  image.width = w;
  image.height = h;
  // encodeURIComponent rather than btoa: the SVG carries non-ASCII (the ellipsis
  // a wrapped label ends in), and btoa throws on anything above U+00FF.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new RasterError('the browser could not render the SVG'));
    image.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new RasterError('no 2d canvas context');
  ctx.drawImage(image, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  if (blob === null) throw new RasterError('the browser could not encode the PNG');
  return { blob, width: w, height: h };
}

/**
 * Offer a blob to the user as a file. Mirrors `downloadText`, and mirrors it
 * closely on purpose: a freshly created anchor, clicked and removed in the
 * same tick, is the one route every browser honours. A long-lived `<a href>`
 * rendered into the page looks tidier and is quietly ignored in some
 * embedded views.
 */
export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
