import { beforeEach, describe, expect, it, vi } from 'vitest';

const domToBlob = vi.fn(async () => new Blob([new Uint8Array(20000)], { type: 'image/png' }));
vi.mock('modern-screenshot', () => ({ domToBlob: (...a: unknown[]) => (domToBlob as (...x: unknown[]) => unknown)(...a) }));

import { MAX_PIXELS, exportPng, isLikelyBlank, pickScale } from '../src/lib/export/png';

beforeEach(() => domToBlob.mockClear());

describe('pickScale', () => {
  it('garde 2 pour une page A4 (2480×3508 ≈ 8,7 millions de pixels)', () => {
    expect(pickScale(1240, 1754)).toBe(2);
    expect(2 * 1240 * 2 * 1754).toBeLessThan(MAX_PIXELS);
  });
  it('réduit l’échelle quand la surface dépasse MAX_PIXELS', () => {
    const s = pickScale(3000, 4000);
    expect(s).toBeLessThan(2);
    expect(3000 * s * (4000 * s)).toBeLessThanOrEqual(MAX_PIXELS);
  });
  it('MAX_PIXELS vaut 4096 × 4096', () => expect(MAX_PIXELS).toBe(16_777_216));
});

describe('exportPng', () => {
  it('exporte les pages une par une avec l’échelle sûre', async () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    const blobs = await exportPng([a, b]);
    expect(blobs).toHaveLength(2);
    expect(domToBlob).toHaveBeenCalledTimes(2);
    expect(domToBlob.mock.calls[0][0]).toBe(a);
    expect(domToBlob.mock.calls[0][1]).toMatchObject({ scale: 2 });
  });
});

describe('isLikelyBlank', () => {
  it('repère une image quasi vide (Safari peut renvoyer une image blanche sans erreur)', () => {
    expect(isLikelyBlank(new Blob([new Uint8Array(500)]))).toBe(true);
    expect(isLikelyBlank(new Blob([new Uint8Array(20000)]))).toBe(false);
  });
});
