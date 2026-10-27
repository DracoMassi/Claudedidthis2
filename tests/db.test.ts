import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportDraft, openDb, type Draft } from '../src/lib/storage/db';

afterEach(() => vi.unstubAllGlobals());

const draft = (id: string, updatedAt: number): Draft => ({
  id, fiche: null, raw: '{"a":1}', brief: { id, matiere: 'maths', niveau: 'mpsi', chapitre: 'C', sujet: 'S' },
  problems: [{ code: 'json', message: 'x' }], updatedAt,
});

async function contrat(db: Awaited<ReturnType<typeof openDb>>) {
  await db.putDraft(draft('a', 1));
  await db.putDraft(draft('b', 3));
  await db.putDraft(draft('c', 2));
  expect((await db.getDraft('a'))?.id).toBe('a');
  expect((await db.listDrafts()).map((d) => d.id)).toEqual(['b', 'c', 'a']); // plus récent d'abord
  await db.deleteDraft('b');
  expect(await db.getDraft('b')).toBeUndefined();
  await db.put('library-index', [{ path: 'x' }]);
  expect(await db.get('library-index')).toEqual([{ path: 'x' }]);
  expect(await db.get('absent')).toBeUndefined();
}

describe('openDb', () => {
  it('fonctionne avec IndexedDB', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    await contrat(await openDb());
  });
  it('sans indexedDB défini : base en mémoire fonctionnelle (navigation privée, stockage vidé)', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await contrat(await openDb());
  });
  it("si l'ouverture d'IndexedDB échoue : repli en mémoire, sans plantage", async () => {
    vi.stubGlobal('indexedDB', { open() { throw new Error('refusé'); } });
    await contrat(await openDb());
  });
});

describe('exportDraft', () => {
  it('renvoie un JSON identique au brouillon', () => {
    const d = draft('a', 1);
    expect(JSON.parse(exportDraft(d))).toEqual(d);
  });
});
