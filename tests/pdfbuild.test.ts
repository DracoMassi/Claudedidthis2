import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildPdfFromPngs, isBlankPixels, pageSizePt, verifyPdf } from '../src/lib/export/pdfBuild';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const rgba = (n: number, f: (i: number) => [number, number, number]) => Uint8ClampedArray.from({ length: n * 4 }, (_, k) => [...f(Math.floor(k / 4)), 255][k % 4]);

describe('export PDF vérifié', () => {
  it('page vide : blanche ou vide = vide ; 2 % de pixels sombres = pas vide', () => {
    expect(isBlankPixels(rgba(1000, () => [255, 255, 255]))).toBe(true);
    expect(isBlankPixels([])).toBe(true);
    expect(isBlankPixels(rgba(1000, (i) => (i % 50 === 0 ? [0, 0, 0] : [255, 255, 255])))).toBe(false);
  });
  it('fabrique un PDF A4 de 3 pages et le relit', async () => {
    const bytes = await buildPdfFromPngs([PNG, PNG, PNG], 'fiche');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getSize()).toEqual(pageSizePt('fiche'));
    expect((await verifyPdf(bytes, 3)).pages).toBe(3);
  });
  it('signale un mauvais nombre de pages et un fichier qui n\'est pas un PDF', async () => {
    expect((await verifyPdf(await buildPdfFromPngs([PNG], 'post'), 2)).problems.join(' ')).toContain('1 page au lieu de 2');
    expect((await verifyPdf(new Uint8Array([1, 2, 3, 4, 5, 6]), 1)).problems).toEqual(expect.arrayContaining(['En-tête PDF absent', 'Le PDF ne se relit pas']));
  });
});
