import { describe, expect, it } from 'vitest';
import { checkPageMarkers, coverage, splitByPage, verifyLot } from '../src/lib/cours/verify';

const lot = { index: 1, fromPage: 6, toPage: 8, data: new Uint8Array([1]) };
const texte = 'Théorème fondamental intégrale continue dérivable primitive fonction intervalle borne';
const md = (pages: number[], body = texte) => pages.map((p) => `<!-- page ${p} -->\n${body}`).join('\n\n');
const pdf = async () => [texte, texte, texte];

describe('contrôle des lots importés', () => {
  it('repères de page : manquant, inattendu, répété, désordre', () => {
    expect(checkPageMarkers(md([6, 7, 8]), lot)).toEqual({ missing: [], unexpected: [], duplicated: [], ordered: true });
    expect(checkPageMarkers(md([6, 8, 8, 3]), lot)).toMatchObject({ missing: [7], unexpected: [3], duplicated: [8], ordered: false });
  });
  it('couverture : mots de 5 lettres ou plus, sans accents ni casse ; découpe par page', () => {
    expect(coverage('Intégrale continue primitive', 'integrale CONTINUE').ratio).toBeCloseTo(2 / 3);
    expect(coverage('a b 12', 'x').ratio).toBe(1);
    expect([...splitByPage(md([6, 7])).keys()]).toEqual([6, 7]);
  });
  it('verdict : ok, page manquante, transcription incomplète, scan sans texte', async () => {
    expect(await verifyLot(lot, md([6, 7, 8]), { extractText: pdf })).toMatchObject({ state: 'ok', coverage: 1 });
    expect(await verifyLot(lot, md([6, 8]), { extractText: pdf })).toMatchObject({ state: 'suspect', missing: [7] });
    const peu = await verifyLot(lot, md([6, 7, 8], 'Trois mots seulement ici'), { extractText: pdf });
    expect(peu.state).toBe('suspect');
    expect(peu.coverage).toBeLessThan(0.7);
    const scan = await verifyLot(lot, md([6, 7, 8]) + '\n[illisible] [illisible]', { extractText: async () => null });
    expect(scan.state).toBe('ok');
    expect(scan.coverage).toBeUndefined();
    expect(scan.notes.join(' ')).toMatch(/Pas de texte.*2 passages \[illisible\]/);
  });
  it("une extraction qui plante n'empêche pas le contrôle des repères", async () => {
    const r = await verifyLot(lot, md([6, 8]), { extractText: async () => { throw new Error('pdfjs'); } });
    expect(r.state).toBe('suspect');
    expect(r.notes.join(' ')).toContain('Comparaison avec le PDF impossible');
  });
});
