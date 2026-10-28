import { NotFoundError } from '../errors';
import type { GithubRepo } from '../github/repo';
import { loadIndex } from '../library/index';
import type { Db } from '../storage/db';
import type { Brief, Fiche, Statut } from '../types';
import { pickCourseSections, pickExamples } from './context';

export function coursStatut(md: string): Statut {
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return fm?.[1].match(/^statut:\s*(\w+)/m)?.[1] === 'verifie' ? 'verifie' : 'a_verifier';
}

/** Lit dans Fiches la charte, les fiches exemples (même matière) et les sections de cours utiles au brief. */
export async function loadSources(
  repo: Pick<GithubRepo, 'readFile' | 'listTree'>, db: Db, brief: Brief,
): Promise<{ charte: string; examples: Fiche[]; sections: string[] }> {
  const items = await loadIndex(repo, db);
  let charte = '';
  try { charte = (await repo.readFile('charte.md')).content; } catch (e) { if (!(e instanceof NotFoundError)) throw e; }
  const fiches: Fiche[] = [];
  for (const i of items.filter((x) => x.kind === 'fiche' && x.matiere === brief.matiere).slice(0, 8)) {
    try { fiches.push(JSON.parse((await repo.readFile(i.path)).content) as Fiche); } catch { /* fichier illisible : ignoré */ }
  }
  const cours: { md: string; statut: Statut }[] = [];
  for (const i of items.filter((x) => x.kind === 'cours' && x.matiere === brief.matiere).slice(0, 6)) {
    try { const md = (await repo.readFile(i.path)).content; cours.push({ md, statut: coursStatut(md) }); } catch { /* ignoré */ }
  }
  return { charte, examples: pickExamples(fiches, brief, 2), sections: pickCourseSections(cours, brief, 3) };
}
