import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFonts } from '../src/lib/github/fonts';
import { AuthError, NotFoundError } from '../src/lib/errors';

const add = vi.fn();
beforeEach(() => {
  add.mockClear();
  vi.stubGlobal('FontFace', class { family: string; constructor(family: string) { this.family = family; } load() { return Promise.resolve(this); } });
  Object.defineProperty(document, 'fonts', { value: { add }, configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('loadFonts', () => {
  it('charge Andaluz et Melbourne quand le dépôt répond', async () => {
    const repo = { readBinary: vi.fn(async () => new ArrayBuffer(8)) };
    const r = await loadFonts(repo);
    expect(r.loaded.sort()).toEqual(['Andaluz', 'Melbourne']);
    expect(r.fallback).toBe(false);
    expect(add).toHaveBeenCalledTimes(3); // Andaluz, Melbourne 400, Melbourne 700
    expect(repo.readBinary.mock.calls.map((c) => c[0])).toEqual(['fonts/Andaluz-Regular.otf', 'fonts/melbourne.ttf', 'fonts/melbournebold.ttf']);
  });
  it('avec un jeton refusé : se résout avec fallback et sans rejet', async () => {
    const repo = { readBinary: vi.fn(async () => { throw new AuthError(); }) };
    await expect(loadFonts(repo)).resolves.toEqual({ loaded: [], fallback: true });
    expect(add).not.toHaveBeenCalled();
  });
  it("une police absente du dépôt n'empêche pas les autres, mais compte comme repli", async () => {
    const repo = { readBinary: vi.fn(async (p: string) => { if (!p.includes('Andaluz')) throw new NotFoundError(); return new ArrayBuffer(8); }) };
    const r = await loadFonts(repo);
    expect(r.loaded).toEqual(['Andaluz']);
    expect(r.fallback).toBe(true);
  });
});
