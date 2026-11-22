import type { Lot } from './chunk';

/** Résultat du contrôle d'un lot transcrit. `suspect` = à relire ou à relancer avant de faire confiance au texte. */
export type LotCheck = {
  state: 'ok' | 'suspect';
  /** Part des mots du PDF retrouvés dans la transcription (absent : PDF sans texte, scan ou photo). */
  coverage?: number;
  /** Pages attendues dont le repère <!-- page N --> manque. */
  missing: number[];
  /** Pages dont le texte est très incomplet par rapport au PDF. */
  weak: number[];
  notes: string[];
};

const MARK = /<!--\s*page\s+(\d+)\s*-->/g;
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

export function pageMarkers(md: string): number[] {
  return [...md.matchAll(MARK)].map((m) => Number(m[1]));
}

/** Compare les repères de page trouvés à ceux attendus pour le lot. */
export function checkPageMarkers(md: string, lot: Pick<Lot, 'fromPage' | 'toPage'>) {
  const found = pageMarkers(md);
  const expected = range(lot.fromPage, lot.toPage);
  return {
    missing: expected.filter((p) => !found.includes(p)),
    unexpected: [...new Set(found.filter((p) => p < lot.fromPage || p > lot.toPage))],
    duplicated: [...new Set(found.filter((p, i) => found.indexOf(p) !== i))],
    ordered: found.every((p, i) => i === 0 || p >= found[i - 1]),
  };
}

const norm = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** Mots de 5 lettres ou plus (les chiffres et symboles de maths sont ignorés : leur extraction est trop bruitée). */
export const wordsOf = (s: string): string[] => norm(s).match(/[a-z]{5,}/g) ?? [];

/** Part des mots distincts de `reference` qui apparaissent dans `candidate`. */
export function coverage(reference: string, candidate: string): { ratio: number; total: number } {
  const ref = [...new Set(wordsOf(reference))];
  if (!ref.length) return { ratio: 1, total: 0 };
  const cand = new Set(wordsOf(candidate));
  return { ratio: ref.filter((w) => cand.has(w)).length / ref.length, total: ref.length };
}

/** Texte du Markdown de chaque page, d'après les repères. */
export function splitByPage(md: string): Map<number, string> {
  const marks = [...md.matchAll(MARK)];
  const out = new Map<number, string>();
  marks.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? md.length) : md.length;
    out.set(Number(m[1]), (out.get(Number(m[1])) ?? '') + md.slice(start, end));
  });
  return out;
}

/** Texte de chaque page du PDF du lot, ou null si le lot n'a pas de couche texte (scan, photo). */
export async function extractPdfPages(lot: Lot): Promise<string[] | null> {
  if (lot.mime && !lot.mime.includes('pdf')) return null;
  const pdfjs = await import('pdfjs-dist');
  const doc = await pdfjs.getDocument({ data: lot.data.slice() }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pages.push(tc.items.map((i) => (i as { str?: string }).str ?? '').join(' '));
  }
  return pages.join('').replace(/\s/g, '').length >= 40 * pages.length ? pages : null;
}

export type VerifyOpts = {
  extractText?: (lot: Lot) => Promise<string[] | null>;
  /** Couverture minimale sur le lot (défaut 0,7 : les figures et formules ne sont pas du texte). */
  minCoverage?: number;
  /** Couverture minimale par page (défaut 0,5). */
  minPageCoverage?: number;
};

/**
 * Contrôle un lot transcrit sans refaire appel à l'IA :
 * 1. repères de page présents, dans l'ordre, sans doublon ;
 * 2. si le PDF a une couche texte : les mots du PDF se retrouvent dans la transcription, lot par lot et page par page.
 */
export async function verifyLot(lot: Lot, md: string, o: VerifyOpts = {}): Promise<LotCheck> {
  const notes: string[] = [];
  let suspect = false;

  const m = checkPageMarkers(md, lot);
  if (m.missing.length) { suspect = true; notes.push(`Repère manquant pour la page ${m.missing.join(', ')}`); }
  if (m.unexpected.length) { suspect = true; notes.push(`Repère inattendu : page ${m.unexpected.join(', ')}`); }
  if (m.duplicated.length) { suspect = true; notes.push(`Page ${m.duplicated.join(', ')} répétée`); }
  if (!m.ordered) { suspect = true; notes.push('Pages dans le désordre'); }

  let ratio: number | undefined;
  const weak: number[] = [];
  try {
    const pages = await (o.extractText ?? extractPdfPages)(lot);
    if (pages) {
      ratio = coverage(pages.join(' '), md).ratio;
      const byPage = splitByPage(md);
      pages.forEach((text, i) => {
        const n = lot.fromPage + i;
        const seg = byPage.get(n);
        const c = coverage(text, seg ?? md);
        if (seg !== undefined && c.total >= 15 && c.ratio < (o.minPageCoverage ?? 0.5)) weak.push(n);
      });
      if (ratio < (o.minCoverage ?? 0.7)) { suspect = true; notes.push(`Seulement ${Math.round(ratio * 100)} % des mots du PDF retrouvés`); }
      if (weak.length) { suspect = true; notes.push(`Page ${weak.join(', ')} très incomplète`); }
    } else {
      notes.push('Pas de texte dans ce PDF : comparaison impossible, seuls les repères de page sont contrôlés');
    }
  } catch {
    notes.push('Comparaison avec le PDF impossible');
  }
  const n = (md.match(/\[illisible\]/g) ?? []).length;
  if (n) notes.push(`${n} passage${n > 1 ? 's' : ''} [illisible]`);

  return { state: suspect ? 'suspect' : 'ok', ...(ratio !== undefined ? { coverage: ratio } : {}), missing: m.missing, weak, notes };
}
