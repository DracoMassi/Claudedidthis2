import { RateLimitError, ServerBusyError } from '../errors';
import { postGeminiDetailed, type GeminiResult } from './client';
import type { RequestBudget } from './budget';
import { withRetry, type RetryEvent, type RetryOpts } from './retry';

export type RobustCfg = {
  key: string;
  /** Modèle principal puis modèles de secours. */
  models: string[];
  /** Plafonds locaux : chaque tentative est comptée, et remboursée si le serveur était surchargé. */
  budget?: RequestBudget;
  onEvent?: (e: RetryEvent) => void;
  fetchImpl?: typeof fetch;
  retry?: Partial<RetryOpts>;
};

/** Liste de modèles à essayer d'après les réglages (principal, puis secours s'il est renseigné). */
export const modelsOf = (s: { model: string; modelSecours?: string }): string[] =>
  [s.model, s.modelSecours ?? ''].map((m) => m.trim()).filter(Boolean);

/** Un appel Gemini avec plafond local, reprises, attente exponentielle et modèle de secours. */
export function robustPost(cfg: RobustCfg, body: unknown): Promise<GeminiResult> {
  return withRetry(async (model) => {
    if (cfg.budget) {
      if (!cfg.budget.canSend()) throw new RateLimitError(cfg.budget.waitSeconds(), true);
      cfg.budget.record();
    }
    try {
      return await postGeminiDetailed({ key: cfg.key, model, body, fetchImpl: cfg.fetchImpl });
    } catch (e) {
      if (e instanceof ServerBusyError) cfg.budget?.refund();
      throw e;
    }
  }, { ...cfg.retry, models: cfg.models, onEvent: cfg.onEvent });
}
