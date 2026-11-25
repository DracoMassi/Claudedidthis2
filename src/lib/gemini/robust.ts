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

/**
 * Modèles à essayer, dans l'ordre. Par défaut le principal puis le secours ; si le secours est « actif » (bouton de bascule),
 * il passe en premier et le principal devient le repli. Sans modèle de secours renseigné, la bascule est sans effet.
 */
export const modelsOf = (s: { model: string; modelSecours?: string; modeleActif?: 'principal' | 'secours' }): string[] => {
  const main = s.model.trim();
  const alt = (s.modelSecours ?? '').trim();
  return (s.modeleActif === 'secours' && alt ? [alt, main] : [main, alt]).filter(Boolean);
};

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
