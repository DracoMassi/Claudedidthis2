import { extractJson } from '../gemini/json';
import type { Msg } from '../gemini/client';
import type { Brief, Fiche, Problem } from '../types';

export type GenerateDeps = {
  llm(messages: Msg[]): Promise<string>;
  validate(d: unknown): Problem[];
  lint(f: Fiche): Problem[];
  render(f: Fiche): { katexErrors: string[]; overflow: number[] };
};
export type GenerateResult = {
  ok: boolean; tours: number; fiche?: Fiche; last?: string; problems: Problem[];
  /** Erreur qui a interrompu la boucle (quota, réseau, clé) : le dernier essai reste dans `last`. */
  error?: unknown;
};

/** Boucle de vérification : au plus `maxTours` tours ; les problèmes de chaque tour repartent au modèle. */
export async function generateFiche(
  _brief: Brief, prompt: { system: string; user: string }, deps: GenerateDeps, maxTours = 4,
): Promise<GenerateResult> {
  const messages: Msg[] = [{ role: 'user', text: prompt.user }];
  let last: string | undefined;
  let problems: Problem[] = [];
  for (let tour = 1; tour <= maxTours; tour++) {
    let raw: string;
    try {
      raw = await deps.llm([...messages]);
    } catch (error) {
      return { ok: false, tours: tour - 1, last, problems, error };
    }
    last = raw;
    messages.push({ role: 'model', text: raw });
    problems = [];
    let data: unknown;
    try { data = extractJson(raw); } catch (e) { problems.push({ code: 'json', message: (e as Error).message }); }
    if (problems.length === 0) problems.push(...deps.validate(data));
    if (problems.length === 0) {
      const f = data as Fiche;
      problems.push(...deps.lint(f));
      const r = deps.render(f);
      problems.push(...r.katexErrors.map((message): Problem => ({ code: 'katex', message })));
      problems.push(...r.overflow.map((p): Problem => ({ code: 'overflow', message: `débordement page ${p} : raccourcis ou découpe en deux pages` })));
      if (problems.length === 0) return { ok: true, tours: tour, fiche: f, last: raw, problems: [] };
    }
    messages.push({
      role: 'user',
      text: `Corrige ces problèmes et renvoie le JSON COMPLET :\n- ${problems.map((p) => `${p.code}${p.path ? ` ${p.path}` : ''} : ${p.message}`).join('\n- ')}`,
    });
  }
  return { ok: false, tours: maxTours, last, problems };
}
