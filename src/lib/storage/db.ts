import type { Brief, Fiche, Problem } from '../types';

export type Draft = {
  id: string; fiche: Fiche | null; raw?: string; brief?: Brief; problems: Problem[]; updatedAt: number;
};
export interface Db {
  putDraft(d: Draft): Promise<void>;
  getDraft(id: string): Promise<Draft | undefined>;
  listDrafts(): Promise<Draft[]>;
  deleteDraft(id: string): Promise<void>;
  put(key: string, value: unknown): Promise<void>;
  get(key: string): Promise<unknown>;
}

const clone = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));
const recent = (a: Draft, b: Draft) => b.updatedAt - a.updatedAt;

function memoryDb(): Db {
  const drafts = new Map<string, Draft>();
  const kv = new Map<string, unknown>();
  return {
    putDraft: async (d) => { drafts.set(d.id, clone(d)); },
    getDraft: async (id) => clone(drafts.get(id)),
    listDrafts: async () => [...drafts.values()].map(clone).sort(recent),
    deleteDraft: async (id) => { drafts.delete(id); },
    put: async (k, v) => { kv.set(k, clone(v)); },
    get: async (k) => clone(kv.get(k)),
  };
}

function idbDb(idb: IDBDatabase): Db {
  const run = <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> =>
    new Promise((resolve, reject) => {
      const req = fn(idb.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  return {
    putDraft: async (d) => { await run('drafts', 'readwrite', (s) => s.put(d)); },
    getDraft: (id) => run<Draft | undefined>('drafts', 'readonly', (s) => s.get(id)),
    listDrafts: async () => (await run<Draft[]>('drafts', 'readonly', (s) => s.getAll())).sort(recent),
    deleteDraft: async (id) => { await run('drafts', 'readwrite', (s) => s.delete(id)); },
    put: async (k, v) => { await run('kv', 'readwrite', (s) => s.put(v, k)); },
    get: (k) => run<unknown>('kv', 'readonly', (s) => s.get(k)),
  };
}

/** Ouvre IndexedDB ; sans IndexedDB (navigation privée, stockage vidé) ou en cas d'échec : base en mémoire. */
export async function openDb(): Promise<Db> {
  if (typeof indexedDB === 'undefined' || !indexedDB) return memoryDb();
  try {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('sequentia', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('drafts', { keyPath: 'id' });
        req.result.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('ouverture bloquée'));
    });
    return idbDb(idb);
  } catch {
    return memoryDb();
  }
}

export const exportDraft = (d: Draft): string => JSON.stringify(d, null, 2);
