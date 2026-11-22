import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildPdfFromPngs, isBlankPixels, pageSizePt, verifyPdf } from '../src/lib/export/pdfBuild';

// PNG 1×1 pixel
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const rgba = (n: number, f: (i: number) => [number, number, number]) => Uint8ClampedArray.from({ length: n * 4 }, (_, k) => { const [r, g, b] = f(Math.floor(k / 4)); return [r, g, b, 255][k % 4]; });

describe('isBlankPixels', () => {
  it('une page blanche est vide', () => expect(isBlankPixels(rgba(1000, () => [255, 255, 255]))).toBe(true));
  it('une page presque blanche avec 2 % de pixels sombres ne l\'est pas', () => {
    expect(isBlankPixels(rgba(1000, (i) => (i % 50 === 0 ? [0, 0, 0] : [255, 255, 255])))).toBe(false);
  });
  it('un tableau vide est vide', () => expect(isBlankPixels([])).toBe(true));
});

describe('buildPdfFromPngs et verifyPdf', () => {
  it('fabrique un PDF de 3 pages A4 et le relit', async () => {
    const bytes = await buildPdfFromPngs([PNG, PNG, PNG], 'fiche');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getSize()).toEqual({ width: pageSizePt('fiche').width, height: pageSizePt('fiche').height });
    const r = await verifyPdf(bytes, 3);
    expect(r.pages).toBe(3);
    expect(r.problems.filter((p) => !p.includes('petit'))).toEqual([]);
  });
  it('signale un nombre de pages inattendu', async () => {
    const r = await verifyPdf(await buildPdfFromPngs([PNG], 'post'), 2);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toContain('1 page au lieu de 2');
  });
  it('signale un fichier qui n\'est pas un PDF', async () => {
    const r = await verifyPdf(new Uint8Array([1, 2, 3, 4, 5, 6]), 1);
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('En-tête PDF absent');
    expect(r.problems).toContain('Le PDF ne se relit pas');
  });
});
