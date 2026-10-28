import { PDFDocument } from 'pdf-lib';

export type Lot = { index: number; fromPage: number; toPage: number; data: Uint8Array; mime?: string };

/** Découpe un PDF en lots de `pagesPerLot` pages (le dernier peut être plus court) ; pages numérotées à partir de 1. */
export async function splitPdf(data: ArrayBuffer, pagesPerLot: number): Promise<Lot[]> {
  if (!Number.isInteger(pagesPerLot) || pagesPerLot < 1) throw new Error('pagesPerLot doit être un entier au moins égal à 1');
  const src = await PDFDocument.load(data);
  const n = src.getPageCount();
  const lots: Lot[] = [];
  for (let from = 0, index = 0; from < n; from += pagesPerLot, index++) {
    const to = Math.min(from + pagesPerLot, n);
    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(src, Array.from({ length: to - from }, (_, k) => from + k));
    pages.forEach((p) => doc.addPage(p));
    lots.push({ index, fromPage: from + 1, toPage: to, data: await doc.save() });
  }
  return lots;
}
