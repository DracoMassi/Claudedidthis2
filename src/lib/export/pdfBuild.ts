import { PDFDocument } from 'pdf-lib';
import { FORMATS } from '../render/formats';
import type { Format } from '../types';
import { exportPng, isLikelyBlank } from './png';

/** Taille de page du PDF en points : A4 exact pour la fiche, 0,75 pt par pixel pour le post. */
export const pageSizePt = (format: Format): { width: number; height: number } =>
  format === 'fiche' ? { width: 595.28, height: 841.89 } : { width: FORMATS.post.width * 0.75, height: FORMATS.post.height * 0.75 };

/** Assemble un PDF : une image PNG par page, à la taille de la page. */
export async function buildPdfFromPngs(pngs: Uint8Array[], format: Format): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const { width, height } = pageSizePt(format);
  for (const b of pngs) {
    const img = await doc.embedPng(b);
    doc.addPage([width, height]).drawImage(img, { x: 0, y: 0, width, height });
  }
  return doc.save();
}

/** Écart-type des niveaux de gris : une page blanche ou unie est quasi à zéro, même une page presque vide de texte en a un. */
export function isBlankPixels(rgba: ArrayLike<number>, minStd = 3): boolean {
  let n = 0, sum = 0, sum2 = 0;
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    const g = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    sum += g; sum2 += g * g; n++;
  }
  if (!n) return true;
  const mean = sum / n;
  return Math.sqrt(Math.max(sum2 / n - mean * mean, 0)) < minStd;
}

/** Version navigateur : réduit l'image à 80 px de large et regarde les pixels. En cas d'impossibilité, ne conclut pas à « vide ». */
export async function blobIsBlank(blob: Blob): Promise<boolean> {
  try {
    const bmp = await createImageBitmap(blob);
    const w = 80, h = Math.max(1, Math.round((80 * bmp.height) / bmp.width));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(bmp, 0, 0, w, h);
    return isBlankPixels(ctx.getImageData(0, 0, w, h).data);
  } catch { return false; }
}

export type PdfCheck = { ok: boolean; pages: number; expected: number; bytes: number; problems: string[] };

/** Relit le PDF fabriqué : en-tête, structure lisible, nombre de pages attendu, taille plausible. */
export async function verifyPdf(bytes: Uint8Array, expected: number): Promise<PdfCheck> {
  const problems: string[] = [];
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') problems.push('En-tête PDF absent');
  let pages = 0;
  try { pages = (await PDFDocument.load(bytes)).getPageCount(); } catch { problems.push('Le PDF ne se relit pas'); }
  if (pages !== expected) problems.push(`${pages} page${pages > 1 ? 's' : ''} au lieu de ${expected}`);
  if (bytes.length < 2000) problems.push('Fichier anormalement petit');
  return { ok: problems.length === 0, pages, expected, bytes: bytes.length, problems };
}

export type PdfReport = PdfCheck & { blankPages: number[] };

/** Fabrique le PDF à partir des pages affichées, après avoir refusé les pages vides, puis le relit. `bytes` n'est fourni que si tout est bon. */
export async function exportVerifiedPdf(pages: HTMLElement[], format: Format): Promise<{ bytes?: Uint8Array; report: PdfReport }> {
  const blobs = await exportPng(pages);
  const blankPages: number[] = [];
  for (const [i, b] of blobs.entries()) if (isLikelyBlank(b) || (await blobIsBlank(b))) blankPages.push(i + 1);
  if (blankPages.length) {
    return { report: { ok: false, pages: 0, expected: pages.length, bytes: 0, problems: [`Page${blankPages.length > 1 ? 's' : ''} vide${blankPages.length > 1 ? 's' : ''} : ${blankPages.join(', ')}`], blankPages } };
  }
  const bytes = await buildPdfFromPngs(await Promise.all(blobs.map(async (b) => new Uint8Array(await b.arrayBuffer()))), format);
  const chk = await verifyPdf(bytes, pages.length);
  return { ...(chk.ok ? { bytes } : {}), report: { ...chk, blankPages } };
}
