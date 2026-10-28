import { NotFoundError } from '../errors';
import type { GenerateDeps, GenerateResult } from '../generate/loop';
import { generateFiche } from '../generate/loop';
import type { GithubRepo } from '../github/repo';
import { slugify } from '../slug';
import type { Brief, Fiche } from '../types';

export { slugify };

export const ficheSavePath = (f: Fiche): string => `corpus/json/${f.meta.matiere}/${slugify(f.meta.titre)}.json`;

/**
 * Écrit la fiche validée dans corpus/json/<matiere>/<slug>.json.
 * - sans baseSha : création ; si le fichier existe déjà, GitHub refuse et ConflictError est propagée ;
 * - avec baseSha : mise à jour ; si le fichier a changé depuis l'ouverture, ConflictError ;
 * - force : relit le sha distant puis écrase (choix explicite de l'utilisateur).
 */
export async function validerFiche(
  repo: Pick<GithubRepo, 'writeFile' | 'readFile'>, fiche: Fiche, opts: { baseSha?: string; force?: boolean } = {},
): Promise<string> {
  const path = ficheSavePath(fiche);
  const verifiee: Fiche = { ...fiche, meta: { ...fiche.meta, statut: 'verifie' } };
  let sha = opts.baseSha;
  if (opts.force) {
    try { sha = (await repo.readFile(path)).sha; } catch (e) { if (e instanceof NotFoundError) sha = undefined; else throw e; }
  }
  await repo.writeFile(path, `${JSON.stringify(verifiee, null, 2)}\n`, { message: `Valider la fiche : ${fiche.meta.titre}`, ...(sha ? { sha } : {}) });
  return path;
}

/** « Corriger avec Gemini » : relance la boucle avec la fiche actuelle et l'instruction ajoutées au message utilisateur. */
export function correctFiche(
  fiche: Fiche, instruction: string, prompt: { system: string; user: string }, deps: GenerateDeps,
): Promise<GenerateResult> {
  const brief: Brief = fiche.meta.brief ?? { id: slugify(fiche.meta.titre), matiere: fiche.meta.matiere, niveau: fiche.meta.niveau, chapitre: fiche.meta.chapitre, sujet: fiche.meta.titre };
  const user = `${prompt.user}\n\nFICHE ACTUELLE :\n${JSON.stringify(fiche)}\n\nINSTRUCTION DE CORRECTION : ${instruction}\nRenvoie le JSON COMPLET de la fiche corrigée.`;
  return generateFiche(brief, { system: prompt.system, user }, deps);
}
