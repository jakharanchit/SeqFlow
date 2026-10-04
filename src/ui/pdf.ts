/**
 * SVG -> vector PDF, through jsPDF + svg2pdf.js. Paths stay paths and text
 * stays text, so the PDF is sharp at any zoom and its labels are searchable.
 *
 * The only caller is the bridge's `exportPdf`, which hands the bytes back to
 * LabVIEW as base64; nothing in the page downloads it.
 */

import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';

/** Acrobat's page limit, in pt. A taller diagram is scaled to fit; it is
 * vector, so zooming in recovers the detail. */
export const MAX_PAGE_PT = 14_400;

export interface PdfResult {
  /** Base64, no `data:` prefix. */
  base64: string;
  /** Page size in pt. */
  width: number;
  height: number;
}

export async function svgToPdf(svgText: string, width: number, height: number): Promise<PdfResult> {
  if (width <= 0 || height <= 0) throw new Error('nothing to export');
  const svg = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement;

  // PDF has no system-font fallback lists and no weight 550: map onto the
  // built-in Helvetica / Courier. Done here rather than in emit/svg.ts so the
  // SVG export itself is unchanged.
  for (const el of Array.from(svg.querySelectorAll('[font-family]')).concat(svg)) {
    const family = el.getAttribute('font-family');
    if (family !== null) el.setAttribute('font-family', /mono|consolas/i.test(family) ? 'courier' : 'helvetica');
  }
  for (const el of Array.from(svg.querySelectorAll('[font-weight]'))) {
    el.setAttribute('font-weight', parseInt(el.getAttribute('font-weight') ?? '', 10) >= 550 ? 'bold' : 'normal');
  }

  const s = Math.min(1, MAX_PAGE_PT / Math.max(width, height));
  const pw = width * s;
  const ph = height * s;
  const doc = new jsPDF({ unit: 'pt', format: [pw, ph], orientation: pw > ph ? 'l' : 'p' });
  await svg2pdf(svg, doc, { x: 0, y: 0, width: pw, height: ph });
  return { base64: doc.output('datauristring').split(',')[1] ?? '', width: pw, height: ph };
}
