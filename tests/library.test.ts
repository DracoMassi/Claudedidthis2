import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildIndex, filterItems, loadIndex, setExemple, type LibraryItem } from '../src/lib/library/index';
import { printPages } from '../src/lib/export/pdf';
import { openDb } from '../src/lib/storage/db';
import { NetworkError } from '../src/lib/errors';

const TREE = [
  { path: 'charte.md', type: 'blob' as const, sha: '0' },
  { path: 'corpus', type: 'tree' as const, sha: '1' },
  { path: 'corpus/json/maths/continuite-1.json', type: 'blob' as const, sha: '2' },
  { path: 'corpus/json/physique/optique.json', type: 'blob' as const, sha: '3' },
  { path: 'corpus/json/maths/.gitkeep', type: 'blob' as const, sha: '4' },
  { path: 'corpus/cours/maths/dénombrement.md', type: 'blob' as const, sha: '5' },
  { path: 'fonts/melbourne.ttf', type: 'blob' as const, sha: '6' },
];

describe('buildIndex', () => {
  it('range fiches et cours, ignore le reste', () => {
    expect(buildIndex(TREE)).toEqual([
      { kind: 'fiche', matiere: 'maths', slug: 'continuite-1', path: 'corpus/json/maths/continuite-1.json', statut: 'verifie' },
      { kind: 'fiche', matiere: 'physique', slug: 'optique', path: 'corpus/json/physique/optique.json', statut: 'verifie' },
      { kind: 'cours', matiere: 'maths', slug: 'dénombrement', path: 'corpus/cours/maths/dénombrement.md' },
    ]);
  });
});

describe('filterItems', () => {
  const items = buildIndex(TREE);
  it('filtre par matière, statut et texte (sans tenir compte des accents ni de la casse)', () => {
    expect(filterItems(items, { matiere: 'maths' })).toHaveLength(2);
    expect(filterItems(items, { statut: 'verifie' })).toHaveLength(2); // les cours n'ont pas de statut connu
    expect(filterItems(items, { text: 'DENOMBREMENT' }).map((i) => i.slug)).toEqual(['dénombrement']);
    expect(filterItems(items, {})).toHaveLength(3);
  });
});

describe('loadIndex', () => {
  const repoOk = () => ({ listTree: vi.fn(async () => TREE) });
  it("fait un seul appel d'arbre et met le résultat en cache", async () => {
    const db = await openDb();
    const repo = repoOk();
    const items = await loadIndex(repo, db);
    expect(repo.listTree).toHaveBeenCalledTimes(1);
    expect(items).toHaveLength(3);
    expect(await db.get('library-index')).toEqual(items);
  });
  it('sert le cache quand le réseau échoue', async () => {
    const db = await openDb();
    const cached: LibraryItem[] = [{ kind: 'fiche', matiere: 'maths', slug: 'x', path: 'corpus/json/maths/x.json', statut: 'verifie' }];
    await db.put('library-index', cached);
    const items = await loadIndex({ listTree: vi.fn(async () => { throw new NetworkError(); }) }, db);
    expect(items).toEqual(cached);
  });
  it("renvoie l'erreur réseau s'il n'y a pas de cache", async () => {
    const db = await openDb();
    await expect(loadIndex({ listTree: vi.fn(async () => { throw new NetworkError(); }) }, db)).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('setExemple', () => {
  it('lit le fichier, positionne meta.exemple et réécrit avec le sha lu', async () => {
    const fiche = { schema_version: '1.1', meta: { titre: 'T', matiere: 'maths', niveau: 'mpsi', chapitre: 'C', statut: 'verifie' }, pages: [] };
    const repo = {
      readFile: vi.fn(async () => ({ content: JSON.stringify(fiche), sha: 'sha-lu' })),
      writeFile: vi.fn(async () => ({ sha: 'n' })),
    };
    await setExemple(repo, 'corpus/json/maths/x.json', true);
    const [path, content, opts] = repo.writeFile.mock.calls[0] as unknown as [string, string, { sha: string; message: string }];
    expect(path).toBe('corpus/json/maths/x.json');
    expect(JSON.parse(content).meta.exemple).toBe(true);
    expect(opts.sha).toBe('sha-lu');
    expect(opts.message).toContain('exemple');
  });
});

describe('printPages', () => {
  beforeEach(() => { window.print = vi.fn(); });
  afterEach(() => document.getElementById('print-page-style')?.remove());
  it('injecte @page aux dimensions du format puis imprime', () => {
    printPages('fiche');
    expect(document.getElementById('print-page-style')?.textContent).toContain('size: 1240px 1754px');
    expect(window.print).toHaveBeenCalledTimes(1);
  });
  it('remplace la règle au lieu de l’empiler', () => {
    printPages('fiche');
    printPages('post');
    expect(document.querySelectorAll('#print-page-style')).toHaveLength(1);
    expect(document.getElementById('print-page-style')?.textContent).toContain('size: 1080px 1350px');
  });
});
