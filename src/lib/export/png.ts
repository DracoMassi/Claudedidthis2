import { domToBlob } from 'modern-screenshot';

/** Limite connue de Safari : 4096 × 4096 pixels de canevas (valeur indicative, dépend de la mémoire). */
export const MAX_PIXELS = 16_777_216;

export function pickScale(width: number, height: number, wanted = 2): number {
  let s = wanted;
  while (width * s * (height * s) > MAX_PIXELS && s > 0.25) s = Math.round((s - 0.1) * 100) / 100;
  return s;
}

/** Une image de moins de 4 Ko est presque sûrement blanche : Safari n'émet pas d'erreur dans ce cas. */
export const isLikelyBlank = (blob: Blob): boolean => blob.size < 4000;

export async function exportPng(pages: HTMLElement[], scale?: number): Promise<Blob[]> {
  const out: Blob[] = [];
  for (const page of pages) {
    const s = scale ?? pickScale(page.offsetWidth, page.offsetHeight);
    out.push(await domToBlob(page, { scale: s, backgroundColor: '#FFFFFF' }));
  }
  return out;
}
