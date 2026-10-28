import { NetworkError } from '../errors';
import type { GithubRepo, TreeEntry } from '../github/repo';
import type { Db } from '../storage/db';
import type { Statut } from '../types';

export type LibraryItem = { kind: 'fiche' | 'cours'; matiere: string; slug: string; path: string; statut?: Statut };

const FICHE = /^corpus\/json\/([^/]+)\/([^/]+)\.json$/;
const COURS = /^corpus\/cours\/([^/]+)\/([^/]+)\.md$/;
const CACHE_KEY = 'library-index';

/** Seules les fiches validées sont enregistrées dans le dépôt : statut `verifie`. Le statut d'un cours se lit à l'ouverture. */
export function buildIndex(tree: TreeEntry[]): LibraryItem[] {
  const items: LibraryItem[] = [];
  for (const e of tree) {
    if (e.type !== 'blob') continue;
    const f = e.path.match(FICHE);
    if (f) { items.push({ kind: 'fiche', matiere: f[1], slug: f[2], path: e.path, statut: 'verifie' }); continue; }
    const c = e.path.match(COURS);
    if (c) items.push({ kind: 'cours', matiere: c[1], slug: c[2], path: e.path });
  }
  return items;
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function filterItems(items: LibraryItem[], f: { matiere?: string; statut?: Statut; text?: string }): LibraryItem[] {
  const q = f.text ? norm(f.text.trim()) : '';
  return items.filter(
    (i) => (!f.matiere || i.matiere === f.matiere) && (!f.statut || i.statut === f.statut) && (!q || norm(`${i.slug} ${i.matiere}`).includes(q)),
  );
}

/** Un seul appel d'arbre ; le résultat est mis en cache et servi si le réseau échoue. */
export async function loadIndex(repo: Pick<GithubRepo, 'listTree'>, db: Db): Promise<LibraryItem[]> {
  try {
    const items = buildIndex(await repo.listTree());
    await db.put(CACHE_KEY, items);
    return items;
  } catch (e) {
    if (e instanceof NetworkError) {
      const cached = await db.get(CACHE_KEY);
      if (Array.isArray(cached)) return cached as LibraryItem[];
    }
    throw e;
  }
}

export async function setExemple(repo: Pick<GithubRepo, 'readFile' | 'writeFile'>, path: string, value: boolean): Promise<void> {
  const { content, sha } = await repo.readFile(path);
  const data = JSON.parse(content) as { meta: Record<string, unknown> };
  data.meta.exemple = value;
  const slug = path.split('/').pop()?.replace(/\.json$/, '') ?? path;
  await repo.writeFile(path, `${JSON.stringify(data, null, 2)}\n`, {
    sha, message: `${value ? 'Marquer comme exemple' : 'Retirer des exemples'} : ${slug}`,
  });
}
