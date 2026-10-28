import { NotFoundError } from '../errors';
import type { GithubRepo } from '../github/repo';
import { slugify } from '../slug';
import { buildCoursMd, type CoursMeta } from './checks';

export const coursPath = (m: Pick<CoursMeta, 'matiere' | 'chapitre'>): string => `corpus/cours/${m.matiere}/${slugify(m.chapitre)}.md`;

/** Enregistre un cours. Un cours déjà présent n'est jamais écrasé sans `force` (ConflictError). */
export async function saveCours(
  repo: Pick<GithubRepo, 'writeFile' | 'readFile'>, meta: CoursMeta, body: string, opts: { baseSha?: string; force?: boolean } = {},
): Promise<string> {
  const path = coursPath(meta);
  let sha = opts.baseSha;
  if (opts.force) {
    try { sha = (await repo.readFile(path)).sha; } catch (e) { if (e instanceof NotFoundError) sha = undefined; else throw e; }
  }
  await repo.writeFile(path, buildCoursMd(meta, body), { message: `Cours : ${meta.chapitre} (${meta.statut})`, ...(sha ? { sha } : {}) });
  return path;
}
