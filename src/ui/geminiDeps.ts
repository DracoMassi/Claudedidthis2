import { buildBody } from '../lib/gemini/client';
import { RequestBudget } from '../lib/gemini/budget';
import { modelsOf, robustPost } from '../lib/gemini/robust';
import type { RetryEvent } from '../lib/gemini/retry';
import type { GenerateDeps } from '../lib/generate/loop';
import { checkOverflow, renderFiche } from '../lib/render/renderFiche';
import { lintLatex } from '../lib/schema/lint';
import { validateFiche } from '../lib/schema/validate';
import type { Settings } from '../lib/storage/settings';
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
export function makeGenerateDeps(s: Settings, system: string, onTour: (n: number) => void, onEvent?: (e: RetryEvent) => void): GenerateDeps {
  const budget = new RequestBudget({ perMinute: s.maxPerMinute, perDay: s.maxPerDay }, undefined, 'sequentia.budget');
  let n = 0;
  return {
    llm: async (messages) => {
      onTour(++n);
      const r = await robustPost({ key: s.geminiKey, models: modelsOf(s), budget, onEvent }, buildBody(system, messages));
      return r.text;
    },
    validate: validateFiche, lint: lintLatex, render: renderOffscreen,
  };
}
