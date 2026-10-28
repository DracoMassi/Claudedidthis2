import katex from 'katex';
import { MACROS } from '../render/macros';
import type { Problem, Statut } from '../types';

export type CoursMeta = { matiere: string; niveau: string; chapitre: string; source: string; statut: Statut };

/** Contrôles automatiques d'un cours transcrit : formules, titre, pages vides, passages illisibles. */
export function checkMarkdown(md: string): Problem[] {
  const out: Problem[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    try {
      katex.renderToString(m[1] ?? m[2], { displayMode: m[1] !== undefined, macros: { ...MACROS }, throwOnError: true, strict: 'error' });
    } catch (e) { out.push({ code: 'katex', message: (e as Error).message }); }
  }
  if (!/^#\s+\S/m.test(md)) out.push({ code: 'lint', message: 'Aucun titre « # » trouvé (titre du chapitre)' });
  const marks = [...md.matchAll(/<!--\s*page\s+(\d+)\s*-->/g)];
  marks.forEach((mk, i) => {
    const debut = (mk.index ?? 0) + mk[0].length;
    const fin = i + 1 < marks.length ? (marks[i + 1].index ?? md.length) : md.length;
    if (md.slice(debut, fin).replace(/\s+/g, '').length < 10) out.push({ code: 'lint', message: `La page ${mk[1]} est vide ou presque` });
  });
  const n = (md.match(/\[illisible\]/g) ?? []).length;
  if (n > 0) out.push({ code: 'lint', message: `${n} passage${n > 1 ? 's' : ''} [illisible] à relire` });
  return out;
}

const yaml = (v: string): string => (/[:#"'\n]|^\s|\s$|^[-?!&*]/.test(v) ? JSON.stringify(v) : v);

/** Fichier cours : front matter de la spec §5.2 puis le Markdown. */
export function buildCoursMd(meta: CoursMeta, body: string): string {
  return `---\nmatiere: ${yaml(meta.matiere)}\nniveau: ${yaml(meta.niveau)}\nchapitre: ${yaml(meta.chapitre)}\nsource: ${yaml(meta.source)}\nstatut: ${meta.statut}\n---\n${body.trim()}\n`;
}
