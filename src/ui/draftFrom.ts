import type { GenerateResult } from '../lib/generate/loop';
import type { Db, Draft } from '../lib/storage/db';
import type { Brief, Fiche } from '../lib/types';

/** Enregistre le résultat d'une génération comme brouillon (même incomplet : le dernier essai reste consultable). */
export async function putDraftFrom(db: Db, brief: Brief, result: GenerateResult): Promise<Draft> {
  const fiche: Fiche | null = result.fiche
    ? { ...result.fiche, meta: { ...result.fiche.meta, statut: 'a_verifier', brief, format: result.fiche.meta.format ?? brief.format ?? 'fiche' } }
    : null;
  const draft: Draft = { id: brief.id, fiche, raw: result.last, brief, problems: result.problems, updatedAt: Date.now() };
  await db.putDraft(draft);
  return draft;
}
