import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../src/lib/generate/context';
import { EMPTY_REFS, blockLabel, countBlocks, loadRefs, mergeRef, refFromFiche, refFromJson, refsToPrompt, removeBlock, removeRef, saveRefs } from '../src/lib/generate/refs';
import { openDb } from '../src/lib/storage/db';
import type { Brief, Fiche } from '../src/lib/types';

const fiche: Fiche = {
  schema_version: '1.1',
  meta: { titre: 'Continuité', matiere: 'maths', niveau: 'mpsi', chapitre: 'C', statut: 'verifie' },
  pages: [
    { titre_page: 'Bases', blocks: [{ type: 'definition', terme: 'Continuité', enonce: 'f est continue en a si…' }, { type: 'theoreme', nom: 'TVI', enonce: 'Soit f…' }] },
    { blocks: [{ type: 'formule', latex: '\\int_a^b f' }, { type: 'qcm', question: 'Quelle proposition ?', choix: [], reponse: 0, explication: '' }] },
  ],
};
const brief: Brief = { id: 'b', matiere: 'maths', niveau: 'mpsi', chapitre: 'C', sujet: 'TVI' };

describe('références de la bibliothèque', () => {
  it('libellés lisibles ; toute la fiche ou seulement les blocs choisis', () => {
    expect(blockLabel(fiche.pages[0].blocks[0])).toBe('Définition : Continuité');
    expect(blockLabel(fiche.pages[1].blocks[0])).toBe('Formule : \\int_a^b f');
    expect(blockLabel({ type: 'piege', texte: 'x'.repeat(200) }).length).toBeLessThan(80);
    expect(refFromFiche(fiche, 'p').blocks.map((b) => [b.page, b.index])).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]]);
    expect(refFromFiche(fiche, 'p', (page, i) => page === 1 && i === 0).blocks).toHaveLength(1);
  });
  it('JSON collé : fiche, liste de blocs, bloc seul ; refus du reste', () => {
    expect(refFromJson(JSON.stringify(fiche)).blocks).toHaveLength(4);
    expect(refFromJson(JSON.stringify(fiche.pages[0].blocks), 'mes blocs')).toMatchObject({ titre: 'mes blocs' });
    expect(refFromJson('{"type":"piege","texte":"a"}').blocks).toHaveLength(1);
    expect(() => refFromJson('pas du json')).toThrow('pas du JSON valide');
    expect(() => refFromJson('[1,2]')).toThrow('Aucun bloc reconnu');
    const t = JSON.stringify(fiche.pages[0].blocks);
    expect(refFromJson(t).id).toBe(refFromJson(t).id);
  });
  it('fusion sans doublon, retrait d\'un bloc, d\'une fiche', () => {
    const a = refFromFiche(fiche, 'f', (p, i) => p === 0 && i === 0);
    let set = mergeRef(mergeRef(EMPTY_REFS, a), refFromFiche(fiche, 'f', (p) => p === 0));
    expect([set.items.length, countBlocks(set)]).toEqual([1, 2]);
    expect(mergeRef(set, refFromFiche(fiche, 'autre')).items).toHaveLength(2);
    set = removeBlock(removeBlock(set, 'f', 0, 0), 'f', 0, 1);
    expect(set.items).toHaveLength(0);
    expect(removeRef(mergeRef(EMPTY_REFS, a), 'f').items).toEqual([]);
  });
  it('dans la requête : consigne selon le mode, limite de taille, avant les extraits de cours', () => {
    const set = mergeRef(EMPTY_REFS, refFromFiche(fiche, 'f'));
    expect(refsToPrompt(EMPTY_REFS)).toBe('');
    expect(refsToPrompt(set)).toContain('inspire-toi');
    expect(refsToPrompt({ ...set, mode: 'reprendre' })).toContain('BLOCS À REPRENDRE');
    expect(refsToPrompt(set, 120)).toMatch(/\(\d+ blocs? omis/);
    const base = { charte: 'C', schema: {}, examples: [], sections: [], brief };
    const avec = buildPrompt({ ...base, refs: set }).user;
    expect(avec.indexOf('RÉFÉRENCES')).toBeGreaterThan(avec.indexOf('EXEMPLES DE FICHES'));
    expect(avec.indexOf('RÉFÉRENCES')).toBeLessThan(avec.indexOf('EXTRAITS DE COURS'));
    expect(buildPrompt(base).user).not.toContain('RÉFÉRENCES');
  });
  it('persistance : relit ce qui est enregistré, repart de zéro sur une valeur invalide', async () => {
    const db = await openDb();
    const set = mergeRef({ items: [], mode: 'reprendre' }, refFromFiche(fiche, 'f'));
    await saveRefs(db, set);
    expect(await loadRefs(db)).toEqual(set);
    await db.put('generate-refs', 'n’importe quoi');
    expect(await loadRefs(db)).toEqual(EMPTY_REFS);
  });
});
