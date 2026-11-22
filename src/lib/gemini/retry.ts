import { AuthError, NetworkError, RateLimitError, ServerBusyError } from '../errors';
import { logAttempt, type AttemptEvent } from './journal';

export type RetryEvent = AttemptEvent & { message: string };
export type RetryOpts = {
  /** Modèle principal, puis modèles de secours dans l'ordre. */
  models: string[];
  /** Essais par modèle (défaut 4 : attentes de 1, 2 et 4 s entre les essais). */
  maxAttempts?: number;
  /** Au-delà de cette attente (secondes), un quota n'est plus attendu : on passe au modèle suivant. */
  maxQuotaWaitSec?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  onEvent?: (e: RetryEvent) => void;
  log?: (e: AttemptEvent) => void;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Exécute `fn` avec reprises. Surcharge (5xx/529) : attente exponentielle avec aléa puis modèle de secours.
 * Quota court : on attend le délai indiqué. Clé refusée ou erreur inconnue : on s'arrête tout de suite.
 * Si tout échoue, l'erreur du modèle principal est relancée (c'est la plus parlante).
 */
export async function withRetry<T>(fn: (model: string) => Promise<T>, o: RetryOpts): Promise<T> {
  const models = [...new Set(o.models.filter(Boolean))];
  if (!models.length) throw new Error('Aucun modèle configuré');
  const sleep = o.sleep ?? wait;
  const rnd = o.random ?? Math.random;
  const now = o.now ?? Date.now;
  const max = o.maxAttempts ?? 4;
  const maxQuota = o.maxQuotaWaitSec ?? 20;
  const log = o.log ?? logAttempt;
  const emit = (e: Omit<AttemptEvent, 't'>, message: string) => {
    const full = { ...e, t: now(), message };
    log(full);
    o.onEvent?.(full);
  };

  let primaryError: unknown;
  for (const [mi, model] of models.entries()) {
    const next = models[mi + 1];
    let lastErr: unknown;
    for (let attempt = 1; attempt <= max; attempt++) {
      const t0 = now();
      try {
        const r = await fn(model);
        emit({ model, attempt, outcome: 'ok', ms: now() - t0 }, `Réponse reçue (${model})`);
        return r;
      } catch (e) {
        lastErr = e;
        const ms = now() - t0;
        if (e instanceof AuthError) { emit({ model, attempt, outcome: 'auth', ms }, 'Clé refusée'); throw e; }
        if (e instanceof RateLimitError) {
          if (e.retryAfterSec <= maxQuota && attempt < max) {
            const w = e.retryAfterSec * 1000 + rnd() * 300;
            emit({ model, attempt, outcome: 'quota', waitMs: w, ms }, `Quota atteint, nouvel essai dans ${Math.ceil(w / 1000)} s`);
            await sleep(w);
            continue;
          }
          emit({ model, attempt, outcome: 'quota', ms }, `Quota atteint (${e.retryAfterSec} s)`);
          if (e.local) throw e;
          break;
        }
        if (e instanceof ServerBusyError) {
          if (attempt < max) {
            const w = Math.min(1000 * 2 ** (attempt - 1), 16_000) + rnd() * 500;
            emit({ model, attempt, outcome: 'busy', status: e.status, waitMs: w, ms },
              `Serveur surchargé (${e.status}), nouvel essai dans ${Math.ceil(w / 1000)} s (essai ${attempt + 1}/${max})`);
            await sleep(w);
            continue;
          }
          emit({ model, attempt, outcome: 'busy', status: e.status, ms },
            next ? `Modèle ${model} indisponible (${e.status}), bascule sur ${next}` : `Modèle ${model} indisponible (${e.status})`);
          break;
        }
        if (e instanceof NetworkError) {
          if (attempt < 2) {
            emit({ model, attempt, outcome: 'network', waitMs: 1000, ms }, 'Pas de réponse, nouvel essai dans 1 s');
            await sleep(1000);
            continue;
          }
          emit({ model, attempt, outcome: 'network', ms }, 'Pas de réponse du réseau');
          if (mi > 0) break; // un modèle de secours qui échoue ne masque pas l'erreur du principal
          throw e;
        }
        emit({ model, attempt, outcome: 'other', ms }, (e as Error).message ?? 'Erreur');
        if (mi > 0) break;
        throw e;
      }
    }
    if (mi === 0) primaryError = lastErr;
  }
  throw primaryError;
}
