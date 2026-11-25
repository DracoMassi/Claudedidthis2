import { buildBody } from '../lib/gemini/client';
import { RequestBudget } from '../lib/gemini/budget';
import { modelsOf, robustPost } from '../lib/gemini/robust';
import type { RetryEvent } from '../lib/gemini/retry';
import type { GenerateDeps } from '../lib/generate/loop';
import { checkOverflow, renderFiche } from '../lib/render/renderFiche';
import { lintLatex } from '../lib/schema/lint';
import { validateFiche } from '../lib/schema/validate';
import { getSettings, type Settings } from '../lib/storage/settings';
import { MAX_TOURS } from '../lib/generate/loop';
import type { Fiche } from '../lib/types';

/** Rend la fiche hors écran, aux dimensions de son format, pour mesurer erreurs KaTeX et débordement. */
export function renderOffscreen(f: Fiche): { katexErrors: string[]; overflow: number[] } {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-99999px;top:0';
  document.body.appendChild(host);
  try {
    const { katexErrors } = renderFiche(host, f);
    return { katexErrors, overflow: checkOverflow(host) };
  } finally { host.remove(); }
}

/**
 * Dépendances de la boucle de génération : Gemini (plafonds locaux, reprises, modèle de secours),
 * validation, lint, rendu. `onEvent` reçoit chaque tentative (« Serveur surchargé, nouvel essai dans 2 s »).
 */
export function makeGenerateDeps(
  s: Settings, system: string, onTour: (n: number) => void, onEvent?: (e: RetryEvent) => void, onPhase?: (message: string) => void,
): GenerateDeps {
  const budget = new RequestBudget({ perMinute: s.maxPerMinute, perDay: s.maxPerDay }, undefined, 'sequentia.budget');
  let n = 0;
  return {
    llm: async (messages) => {
      onTour(++n);
      // Les modèles sont relus à chaque envoi : le bouton « Modèle utilisé » agit dès le prochain appel.
      const models = modelsOf(getSettings());
      onPhase?.(`Tour ${n} sur ${MAX_TOURS} : envoi à Gemini (${models[0]})…`);
      const r = await robustPost({ key: s.geminiKey, models, budget, onEvent }, buildBody(system, messages));
      onPhase?.(`Tour ${n} sur ${MAX_TOURS} : réponse reçue, lecture du JSON…`);
      return r.text;
    },
    validate: (d) => { onPhase?.('Contrôle du schéma…'); return validateFiche(d); },
    lint: (f) => { onPhase?.('Contrôle du LaTeX…'); return lintLatex(f); },
    render: (f) => { onPhase?.('Rendu de la fiche et contrôle du débordement…'); return renderOffscreen(f); },
  };
}
