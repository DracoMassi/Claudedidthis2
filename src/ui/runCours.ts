import { ImportQueue } from '../lib/cours/queue';
import { transcribeLot, transcribeRobust } from '../lib/cours/transcribe';
import { verifyLot } from '../lib/cours/verify';
import { NetworkError, RateLimitError } from '../lib/errors';
import { RequestBudget } from '../lib/gemini/budget';
import { modelsOf, type RobustCfg } from '../lib/gemini/robust';
import { dismissJob, finishJob, getJob, isRunning, startJob, updateJob } from '../lib/jobs/store';
import type { Db } from '../lib/storage/db';
import { getSettings } from '../lib/storage/settings';
import { messageFor } from './messages';

/** Reprises automatiques : au plus 3 d'affilée, puis on laisse la main. */
const MAX_AUTO = 3;
let timer: number | undefined;
let autoTries = 0;
let pending: { db: Db; id: string; title: string } | null = null;

/** File d'import branchée sur Gemini : reprises, modèle de secours, plafonds locaux, contrôle de chaque lot. */
function buildQueue(db: Db, onErr: (e: unknown) => void, onMessage: (m: string) => void): ImportQueue {
  const s = getSettings();
  const budget = new RequestBudget({ perMinute: s.maxPerMinute, perDay: s.maxPerDay }, undefined, 'sequentia.budget');
  return new ImportQueue(db, async (lot) => {
    try {
      // Modèles relus à chaque lot : le bouton « Modèle utilisé » agit dès le lot suivant.
      const cfg: RobustCfg = { key: s.geminiKey, models: modelsOf(getSettings()), budget, onEvent: (e) => onMessage(e.message) };
      return await transcribeLot(lot, { llm: (l) => transcribeRobust({ cfg, lot: l }) });
    } catch (e) { onErr(e); throw e; }
  }, (lot, md) => verifyLot(lot, md));
}

/** Annule la reprise automatique prévue (la progression reste enregistrée). */
export function cancelAuto(): void {
  window.clearTimeout(timer);
  timer = undefined;
  pending = null;
  autoTries = 0;
  if (getJob('cours')?.state === 'waiting') finishJob('cours', { state: 'error', outcome: 'warn', message: 'Reprise automatique annulée. La progression est gardée : reprends quand tu veux' });
}

/** Relance tout de suite au lieu d'attendre la fin du délai. */
export function resumeNow(): void {
  if (!pending) return;
  const c = pending;
  window.clearTimeout(timer);
  pending = null;
  void startCoursRun(c.db, c.id, c.title, true);
}

const phaseText = (p: { index: number; total: number }) => `Lot ${p.index + 1} sur ${p.total}`;

/**
 * Transcrit les lots restants d'un import. Continue quand on change d'onglet ; après une pause réseau ou quota court,
 * repart seul (3 fois au plus). Renvoie false si une transcription est déjà en cours.
 */
export async function startCoursRun(db: Db, id: string, title: string, auto = false): Promise<boolean> {
  if (isRunning('cours')) return false;
  window.clearTimeout(timer);
  pending = null;
  if (!auto) autoTries = 0;
  startJob('cours', { title, ref: id, steps: 1, message: "Reprise de l'import…" });
  let last: unknown;
  const q = buildQueue(db, (e) => { last = e; }, (m) => updateJob('cours', { message: m }));
  try {
    const r = await q.run(id, (p) => {
      if (p.phase === 'start') updateJob('cours', { step: p.index + 1, steps: p.total, message: `${phaseText(p)} : transcription par Gemini (${modelsOf(getSettings())[0]})…` });
      else updateJob('cours', { message: `${phaseText(p)} ${p.state === 'ok' ? 'transcrit et vérifié' : p.state === 'suspect' ? 'transcrit, à contrôler' : 'en échec'}` });
    });
    if (r === 'done') {
      autoTries = 0;
      finishJob('cours', { state: 'done', outcome: 'ok', message: 'Transcription terminée. Relis les lots marqués « À contrôler »' });
    } else if ((last instanceof NetworkError || (last instanceof RateLimitError && last.retryAfterSec <= 120)) && autoTries < MAX_AUTO && navigator.onLine !== false) {
      autoTries += 1;
      const delay = last instanceof RateLimitError ? last.retryAfterSec + 1 : 30;
      pending = { db, id, title };
      updateJob('cours', { state: 'waiting', resumeAt: Date.now() + delay * 1000, message: `${messageFor(last)}. Nouvel essai automatique (${autoTries}/${MAX_AUTO}). La progression est gardée` });
      timer = window.setTimeout(() => { pending = null; void startCoursRun(db, id, title, true); }, delay * 1000);
    } else {
      finishJob('cours', { state: 'error', outcome: 'error', message: `${last ? messageFor(last) : 'En pause'}. La progression est gardée` });
    }
  } catch (e) {
    finishJob('cours', { state: 'error', outcome: 'error', message: messageFor(e) });
  }
  return true;
}

/** Relance un seul lot (suspect ou en échec). */
export async function rerunCoursLot(db: Db, id: string, i: number, title: string): Promise<boolean> {
  if (isRunning('cours')) return false;
  window.clearTimeout(timer);
  pending = null;
  startJob('cours', { title: `${title} · lot ${i + 1}`, ref: id, steps: 1, message: `Relance du lot ${i + 1}…` });
  try {
    const q = buildQueue(db, () => undefined, (m) => updateJob('cours', { message: m }));
    const st = await q.rerun(id, i, (p) => updateJob('cours', { step: 1, message: `Lot ${p.index + 1} : transcription par Gemini (${modelsOf(getSettings())[0]})…` }));
    finishJob('cours', { state: 'done', outcome: st.state === 'ok' ? 'ok' : 'warn', message: st.state === 'ok' ? `Lot ${i + 1} relu et vérifié` : `Lot ${i + 1} retranscrit, mais il reste à contrôler` });
  } catch (e) {
    finishJob('cours', { state: 'error', outcome: 'error', message: messageFor(e) });
  }
  return true;
}

export { dismissJob };
