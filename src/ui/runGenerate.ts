import { buildPrompt } from '../lib/generate/context';
import { MAX_TOURS, generateFiche } from '../lib/generate/loop';
import type { RefSet } from '../lib/generate/refs';
import { loadSources } from '../lib/generate/sources';
import type { GithubRepo } from '../lib/github/repo';
import { finishJob, isRunning, startJob, updateJob } from '../lib/jobs/store';
import schema from '../lib/schema/schema.json';
import { putDraftFrom } from './draftFrom';
import type { Db } from '../lib/storage/db';
import { getSettings } from '../lib/storage/settings';
import type { Brief } from '../lib/types';
import { makeGenerateDeps } from './geminiDeps';
import { messageFor } from './messages';

/**
 * Lance la génération d'une fiche, hors de tout composant : elle continue quand on change d'onglet, et sa progression
 * est publiée dans le store des tâches. Renvoie false si une génération est déjà en cours.
 */
export async function runGenerate(o: { repo: GithubRepo; db: Db; brief: Brief; refs?: RefSet }): Promise<boolean> {
  if (isRunning('generate')) return false;
  const s = getSettings();
  startJob('generate', { title: o.brief.sujet || o.brief.id, steps: MAX_TOURS, ref: o.brief.id, message: 'Lecture de ton dépôt : charte, exemples et cours…' });
  try {
    await document.fonts?.ready;
    let src;
    try { src = await loadSources(o.repo, o.db, o.brief); }
    catch (e) { finishJob('generate', { state: 'error', outcome: 'error', message: messageFor(e, { source: 'github' }) }); return true; }
    const prompt = buildPrompt({ charte: src.charte, schema: schema as object, examples: src.examples, sections: src.sections, brief: o.brief, refs: o.refs });
    updateJob('generate', { step: 1, message: 'Préparation de la requête…' });
    const result = await generateFiche(o.brief, prompt, makeGenerateDeps(
      s, prompt.system,
      (n) => updateJob('generate', { step: n }),
      (e) => updateJob('generate', { message: e.message }),
      (m) => updateJob('generate', { message: m }),
    ));
    await putDraftFrom(o.db, o.brief, result);
    const message = result.error ? messageFor(result.error)
      : !result.ok ? "La fiche n'a pas passé tous les contrôles. Le dernier essai est gardé dans les brouillons"
      : `Brouillon prêt après ${result.tours} tour${result.tours > 1 ? 's' : ''}`;
    finishJob('generate', { state: result.error ? 'error' : 'done', outcome: result.error ? 'error' : result.ok ? 'ok' : 'warn', message, problems: result.problems, ref: o.brief.id });
  } catch (e) {
    finishJob('generate', { state: 'error', outcome: 'error', message: messageFor(e) });
  }
  return true;
}
