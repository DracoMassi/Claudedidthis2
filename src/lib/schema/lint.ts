import type { Fiche, Problem } from '../types';

// Mêmes règles que INTERDITS dans orchestrate.py (aligned reste autorisé).
const INTERDITS: [RegExp, string][] = [
  [/\\usepackage/, '\\usepackage'],
  [/\\begin\{(?:align|equation|eqnarray)\*?\}/, 'environnement align/equation'],
  [/\\\[|\\\(/, '\\[ ou \\('],
  [/\\tikz/, '\\tikz'],
  [/\\textbf/, '\\textbf'],
];

function* textes(o: unknown, path = ''): Generator<[string, string]> {
  if (typeof o === 'string') yield [path, o];
  else if (Array.isArray(o)) for (let i = 0; i < o.length; i++) yield* textes(o[i], `${path}/${i}`);
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) yield* textes(v, `${path}/${k}`);
}

export function lintLatex(fiche: Fiche): Problem[] {
  const out: Problem[] = [];
  for (const [path, t] of textes(fiche)) {
    for (const [re, label] of INTERDITS) {
      if (re.test(t)) out.push({ code: 'lint', message: `LaTeX interdit (${label}) dans : ${t.slice(0, 60)}…`, path });
    }
  }
  return out;
}
