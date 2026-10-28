import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { validateFiche } from '../src/lib/schema/validate';

const load = (n: string) => JSON.parse(readFileSync(`tests/fixtures/${n}`, 'utf8'));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('validateFiche', () => {
  it('accepte la fiche v1.1', () => expect(validateFiche(load('fiche-v11.json'))).toEqual([]));
  it('accepte la fiche v1.0 (sans meta.format)', () => expect(validateFiche(load('fiche-v10.json'))).toEqual([]));
  it('refuse un $ dans formule.latex, avec un chemin contenant latex', () => {
    const f = clone(load('fiche-v10.json'));
    f.pages[0].blocks[4].latex = '$2^n$';
    const p = validateFiche(f);
    expect(p.length).toBeGreaterThan(0);
    expect(p[0].code).toBe('schema');
    expect(p.some((x) => x.path?.includes('latex'))).toBe(true);
  });
  it('refuse un statut inconnu', () => {
    const f = clone(load('fiche-v10.json'));
    f.meta.statut = 'brouillon';
    expect(validateFiche(f).some((x) => x.path?.includes('statut'))).toBe(true);
  });
  it('refuse un bloc figure sans svg', () => {
    const f = clone(load('fiche-v11.json'));
    delete f.pages[0].blocks[1].svg;
    const p = validateFiche(f);
    expect(p.some((x) => x.path?.includes('svg'))).toBe(true);
  });
  it('refuse un type de bloc inconnu', () => {
    const f = clone(load('fiche-v10.json'));
    f.pages[0].blocks[0] = { type: 'inconnu' };
    expect(validateFiche(f).length).toBeGreaterThan(0);
  });
  it("ne plante pas sur autre chose qu'un objet", () => {
    expect(validateFiche(null).length).toBeGreaterThan(0);
    expect(validateFiche('x').length).toBeGreaterThan(0);
  });
});
