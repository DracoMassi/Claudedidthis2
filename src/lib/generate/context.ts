import type { Brief, Fiche, Statut } from '../types';
import { splitSections } from './sections';

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const mots = (s: string) => [...new Set(norm(s).match(/[a-z0-9]{4,}/g) ?? [])];
const score = (text: string, words: string[]) => {
  const t = norm(text);
  return words.reduce((n, w) => n + (t.split(w).length - 1), 0);
};

/** Fiches de la même matière : d'abord celles marquées `exemple`, puis par proximité de mots-clés avec le sujet. */
export function pickExamples(fiches: Fiche[], brief: Brief, k = 2): Fiche[] {
  const w = mots(`${brief.sujet} ${brief.chapitre}`);
  return fiches
    .filter((f) => f.meta.matiere === brief.matiere)
    .map((f) => ({ f, ex: f.meta.exemple === true ? 1 : 0, s: score(JSON.stringify(f), w) }))
    .sort((a, b) => b.ex - a.ex || b.s - a.s)
    .slice(0, k)
    .map((x) => x.f);
}

/** Sections de cours proches du sujet ; les cours `verifie` passent avant `a_verifier` ; les sections hors-sujet sont écartées. */
export function pickCourseSections(cours: { md: string; statut: Statut }[], brief: Brief, k = 3): string[] {
  const w = mots(`${brief.sujet} ${brief.chapitre}`);
  return cours
    .flatMap((c) => splitSections(c.md).map((s) => ({ ...s, rang: c.statut === 'verifie' ? 0 : 1, s: score(`${s.titre} ${s.texte}`, w) })))
    .filter((x) => x.s > 0)
    .sort((a, b) => a.rang - b.rang || b.s - a.s)
    .slice(0, k)
    .map((x) => `## ${x.titre}\n${x.texte}`);
}

export function buildPrompt(i: { charte: string; schema: object; examples: Fiche[]; sections: string[]; brief: Brief }): { system: string; user: string } {
  const format = i.brief.format ?? 'fiche';
  const system = `Tu es l'auteur des fiches Séquentia, niveau ${i.brief.niveau} (classes préparatoires et lycée).
Tu réponds UNIQUEMENT par un objet JSON conforme au schéma ci-dessous. Aucun texte autour.

RÈGLES
- Rigueur : hypothèses explicites, quantificateurs corrects, aucune affirmation non justifiée.
- Ne contredis jamais les extraits de cours fournis ; si une information manque, omets-la.
- LaTeX entre $...$ ou $$...$$ dans les textes. Dans le JSON, échappe chaque backslash : "\\\\frac{a}{b}".
- formule.latex : LaTeX BRUT, jamais de $ autour.
- Utilise les macros de la charte (\\R, \\dd, \\e, \\i, \\abs{}, \\inte{a}{b}, \\card…). Pas de \\usepackage, pas de TikZ, pas de \\textbf dans les formules ; équations multilignes en aligned uniquement.
- schema_version = "1.1" ; meta.statut = "a_verifier" ; meta.format = "${format}".
- Format « fiche » (A4) : une page dense par idée directrice. Format « post » : pages courtes de 1080×1350.

CHARTE ÉDITORIALE
${i.charte}

SCHÉMA
${JSON.stringify(i.schema)}
`;
  const ex = i.examples.length ? i.examples.map((f) => JSON.stringify(f)).join('\n---\n') : '(aucun exemple disponible)';
  const cs = i.sections.length ? i.sections.join('\n---\n') : '(aucun extrait de cours disponible)';
  const user = `EXEMPLES DE FICHES (style à imiter) :\n${ex}\n\nEXTRAITS DE COURS (source de vérité) :\n${cs}\n\nBRIEF :\n${JSON.stringify(i.brief)}`;
  return { system, user };
}
