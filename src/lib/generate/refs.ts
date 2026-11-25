import type { Db } from '../storage/db';
import type { Block, Fiche } from '../types';

/** Un bloc de fiche (définition, théorème, QCM…) mis de côté pour la génération. `page` et `index` sont comptés depuis 0. */
export type RefBlock = { page: number; index: number; block: Block };
/** Les blocs retenus d'une même fiche (ou d'un JSON collé). */
export type Ref = { id: string; titre: string; path?: string; matiere?: string; blocks: RefBlock[] };
/** inspire : style et structure ; reprendre : les blocs sont intégrés à la fiche. */
export type RefMode = 'inspire' | 'reprendre';
export type RefSet = { items: Ref[]; mode: RefMode };
export const EMPTY_REFS: RefSet = { items: [], mode: 'inspire' };

const TYPES: Record<string, string> = {
  definition: 'Définition', theoreme: 'Théorème', demonstration: 'Démonstration', methode: 'Méthode', formule: 'Formule',
  piege: 'Piège', exemple: 'Exemple', qcm: 'QCM', proprietes: 'Propriétés', figure: 'Figure',
};
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const clip = (t: string, n = 60) => { const x = t.replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

/** Libellé court d'un bloc pour les listes : « Théorème : Rolle », « Formule : \int_a^b… ». */
export function blockLabel(b: Block): string {
  const type = TYPES[b.type] ?? b.type;
  const detail = str(b.terme) || str(b.nom) || str(b.titre) || str(b.question) || str(b.latex) || str(b.enonce) || str(b.texte) || str(b.legende);
  return detail ? `${type} : ${clip(detail)}` : type;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isBlock = (x: unknown): x is Block => isObj(x) && typeof x.type === 'string';
const isFiche = (x: unknown): x is Fiche => isObj(x) && Array.isArray(x.pages) && isObj(x.meta);
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

/** Blocs d'une fiche ; `pick(page, index)` permet de n'en garder que certains (sans `pick` : toute la fiche). */
export function refFromFiche(f: Fiche, path?: string, pick?: (page: number, index: number) => boolean): Ref {
  const blocks = f.pages.flatMap((p, page) => p.blocks.map((block, index) => ({ page, index, block }))).filter((x) => !pick || pick(x.page, x.index));
  return { id: path ?? `colle-${hash(JSON.stringify(f.pages))}`, titre: f.meta?.titre || 'Fiche sans titre', path, matiere: f.meta?.matiere, blocks };
}

/** Lit du JSON collé ou déposé : une fiche complète, un bloc, ou une liste de blocs. */
export function refFromJson(text: string, name = 'JSON collé'): Ref {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error("Ce texte n'est pas du JSON valide"); }
  if (isFiche(data)) return refFromFiche(data);
  const blocks = (Array.isArray(data) ? data : [data]).filter(isBlock).map((block, index) => ({ page: 0, index, block }));
  if (!blocks.length) throw new Error('Aucun bloc reconnu : colle une fiche, un bloc ou une liste de blocs (chacun avec un champ « type »)');
  return { id: `colle-${hash(JSON.stringify(blocks))}`, titre: name, blocks };
}

export const countBlocks = (set: RefSet): number => set.items.reduce((n, r) => n + r.blocks.length, 0);

/** Ajoute les blocs d'une référence ; ceux déjà présents (même fiche, même position) ne sont pas dupliqués. */
export function mergeRef(set: RefSet, ref: Ref): RefSet {
  const cur = set.items.find((r) => r.id === ref.id);
  if (!cur) return { ...set, items: [...set.items, ref] };
  const has = new Set(cur.blocks.map((b) => `${b.page}.${b.index}`));
  const added = ref.blocks.filter((b) => !has.has(`${b.page}.${b.index}`));
  return { ...set, items: set.items.map((r) => (r.id === ref.id ? { ...r, blocks: [...r.blocks, ...added] } : r)) };
}
export const removeRef = (set: RefSet, id: string): RefSet => ({ ...set, items: set.items.filter((r) => r.id !== id) });
export function removeBlock(set: RefSet, id: string, page: number, index: number): RefSet {
  return { ...set, items: set.items.map((r) => (r.id === id ? { ...r, blocks: r.blocks.filter((b) => !(b.page === page && b.index === index)) } : r)).filter((r) => r.blocks.length > 0) };
}

const HEAD: Record<RefMode, string> = {
  inspire: "RÉFÉRENCES CHOISIES PAR L'AUTEUR (blocs de fiches existantes) : inspire-toi de leur structure, de leur niveau de détail et de leurs notations pour la fiche demandée. Ne les recopie pas mot pour mot. Ne contredis jamais les extraits de cours.",
  reprendre: "BLOCS À REPRENDRE (choisis par l'auteur dans ses fiches existantes) : intègre ces blocs dans la fiche, avec le même contenu et le LaTeX conservé ; ne les reformule que pour garder la cohérence de l'ensemble. Complète ensuite le reste du brief autour d'eux. Si un bloc contredit les extraits de cours, corrige-le.",
};

/** Texte à insérer dans la requête ; chaîne vide s'il n'y a aucun bloc. Au-delà de `maxChars`, les blocs restants sont omis et signalés. */
export function refsToPrompt(set: RefSet, maxChars = 16000): string {
  if (countBlocks(set) === 0) return '';
  let used = 0, skipped = 0;
  const parts: string[] = [];
  for (const r of set.items) {
    const lines: string[] = [];
    for (const b of r.blocks) {
      const j = JSON.stringify(b.block);
      if (used + j.length > maxChars) { skipped++; continue; }
      used += j.length;
      lines.push(j);
    }
    if (lines.length) parts.push(`Fiche « ${r.titre} »${r.matiere ? ` (${r.matiere})` : ''} :\n${lines.join('\n')}`);
  }
  return `${HEAD[set.mode]}\n\n${parts.join('\n---\n')}${skipped ? `\n(${skipped} bloc${skipped > 1 ? 's' : ''} omis : trop volumineux)` : ''}`;
}

const KEY = 'generate-refs';
export async function loadRefs(db: Db): Promise<RefSet> {
  try {
    const v = (await db.get(KEY)) as Partial<RefSet> | undefined;
    if (v && Array.isArray(v.items)) return { items: v.items, mode: v.mode === 'reprendre' ? 'reprendre' : 'inspire' };
  } catch { /* base illisible : repart de zéro */ }
  return EMPTY_REFS;
}
export const saveRefs = (db: Db, set: RefSet): Promise<void> => db.put(KEY, set);
