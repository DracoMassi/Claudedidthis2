import { describe, expect, it, vi } from 'vitest';
import { coursStatut, loadSources } from '../src/lib/generate/sources';
import { openDb } from '../src/lib/storage/db';
import { NotFoundError } from '../src/lib/errors';
import type { Brief } from '../src/lib/types';

const brief: Brief = { id: 'b', matiere: 'maths', niveau: 'mpsi', chapitre: 'Continuité', sujet: 'valeurs intermédiaires' };
const fiche = (titre: string, matiere = 'maths') => JSON.stringify({ schema_version: '1.1', meta: { titre, matiere, niveau: 'mpsi', chapitre: 'C', statut: 'verifie' }, pages: [] });
const files: Record<string, string> = {
  'charte.md': 'CHARTE',
  'corpus/json/maths/a.json': fiche('Valeurs intermédiaires'),
  'corpus/json/physique/b.json': fiche('Optique', 'physique'),
  'corpus/cours/maths/c.md': '---\nstatut: verifie\n---\n# C\n## TVI\nvaleurs intermédiaires validées',
};
const tree = Object.keys(files).map((path, i) => ({ path, type: 'blob' as const, sha: String(i) }));
const repo = () => ({
  listTree: vi.fn(async () => tree),
  readFile: vi.fn(async (p: string) => { if (!(p in files)) throw new NotFoundError(); return { content: files[p], sha: 's' }; }),
});

describe('coursStatut', () => {
  it('lit le statut du front matter, sinon a_verifier', () => {
    expect(coursStatut('---\nstatut: verifie\n---\n# x')).toBe('verifie');
    expect(coursStatut('---\nstatut: a_verifier\n---\n# x')).toBe('a_verifier');
    expect(coursStatut('# sans front matter')).toBe('a_verifier');
  });
});

describe('loadSources', () => {
  it('charge la charte, les exemples de la même matière et les sections de cours', async () => {
    const s = await loadSources(repo(), await openDb(), brief);
    expect(s.charte).toBe('CHARTE');
    expect(s.examples.map((f) => f.meta.titre)).toEqual(['Valeurs intermédiaires']);
    expect(s.sections[0]).toContain('validées');
  });
  it("accepte un dépôt sans charte, sans exemple ni cours", async () => {
    const vide = { listTree: vi.fn(async () => []), readFile: vi.fn(async () => { throw new NotFoundError(); }) };
    expect(await loadSources(vide, await openDb(), brief)).toEqual({ charte: '', examples: [], sections: [] });
  });
});
