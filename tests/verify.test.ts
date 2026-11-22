import { describe, expect, it } from 'vitest';
import { checkPageMarkers, coverage, splitByPage, verifyLot } from '../src/lib/cours/verify';

const lot = { index: 1, fromPage: 6, toPage: 8, data: new Uint8Array([1]) };
const md = (...pages: number[]) => pages.map((p) => `<!-- page ${p} -->\nTexte de la page ${p} avec suffisamment de contenu.`).join('\n\n');
const texte = 'Théorème fondamental intégrale continue dérivable primitive fonction intervalle borne';

describe('checkPageMarkers', () => {
  it('tout est présent', () => expect(checkPageMarkers(md(6, 7, 8), lot)).toEqual({ missing: [], unexpected: [], duplicated: [], ordered: true }));
  it('repère manquant, inattendu, répété, désordre', () => {
    const r = checkPageMarkers(md(6, 8, 8, 3), lot);
    expect(r.missing).toEqual([7]);
    expect(r.unexpected).toEqual([3]);
    expect(r.duplicated).toEqual([8]);
    expect(r.ordered).toBe(false);
  });
});

describe('coverage', () => {
  it('compte les mots de 5 lettres ou plus, sans accents ni casse', () => {
    expect(coverage('Intégrale continue primitive', 'integrale CONTINUE').ratio).toBeCloseTo(2 / 3);
  });
  it('référence sans mots : 1', () => expect(coverage('a b 12', 'x').ratio).toBe(1));
});

describe('splitByPage', () => {
  it('découpe par repère', () => expect([...splitByPage(md(6, 7)).keys()]).toEqual([6, 7]));
});

describe('verifyLot', () => {
  const pdf = async () => [texte, texte, texte];
  it('ok : repères présents et texte retrouvé', async () => {
    const m = [6, 7, 8].map((p) => `<!-- page ${p} -->\n${texte}`).join('\n\n');
    const r = await verifyLot(lot, m, { extractText: pdf });
    expect(r.state).toBe('ok');
    expect(r.coverage).toBe(1);
  });
  it('suspect : page manquante', async () => {
    const m = [6, 8].map((p) => `<!-- page ${p} -->\n${texte}`).join('\n\n');
    const r = await verifyLot(lot, m, { extractText: pdf });
    expect(r.state).toBe('suspect');
    expect(r.missing).toEqual([7]);
  });
  it('suspect : transcription très incomplète', async () => {
    const m = [6, 7, 8].map((p) => `<!-- page ${p} -->\nTrois mots seulement ici`).join('\n\n');
    const r = await verifyLot(lot, m, { extractText: pdf });
    expect(r.state).toBe('suspect');
    expect(r.coverage).toBeLessThan(0.7);
  });
  it('suspect : une page vide au milieu de pages complètes', async () => {
    const long = Array.from({ length: 20 }, (_, i) => `motnumero${String.fromCharCode(97 + i)}${'x'.repeat(i)}`).join(' ').replace(/\d/g, '');
    const m = `<!-- page 6 -->\n${long}\n<!-- page 7 -->\nrien\n<!-- page 8 -->\n${long}`;
    const r = await verifyLot(lot, m, { extractText: async () => [long, long, long] });
    expect(r.weak).toEqual([7]);
    expect(r.state).toBe('suspect');
  });
  it('PDF sans texte (scan) : seuls les repères sont contrôlés, avec une note', async () => {
    const r = await verifyLot(lot, md(6, 7, 8), { extractText: async () => null });
    expect(r.state).toBe('ok');
    expect(r.coverage).toBeUndefined();
    expect(r.notes.join(' ')).toContain('Pas de texte');
  });
  it('compte les passages [illisible]', async () => {
    const r = await verifyLot(lot, md(6, 7, 8) + '\n[illisible] [illisible]', { extractText: async () => null });
    expect(r.notes.join(' ')).toContain('2 passages [illisible]');
  });
  it("une extraction qui plante n'empêche pas le contrôle des repères", async () => {
    const r = await verifyLot(lot, md(6, 8), { extractText: async () => { throw new Error('pdfjs'); } });
    expect(r.state).toBe('suspect');
    expect(r.notes.join(' ')).toContain('Comparaison avec le PDF impossible');
  });
});
