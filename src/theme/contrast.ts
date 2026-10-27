import type { TokenName, Tokens } from './themes';

const lum = (hex: string): number => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** Rapport de contraste WCAG entre deux couleurs #RRGGBB. */
export function contrastRatio(fg: string, bg: string): number {
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** Variables dont le contraste est trop faible (texte 4,5:1, titres rouges 3:1, bouton 4,5:1). */
export function contrastWarnings(t: Tokens): TokenName[] {
  const w = new Set<TokenName>();
  if (contrastRatio(t['--text'], t['--page-bg']) < 4.5 || contrastRatio(t['--text'], t['--card']) < 4.5) w.add('--text');
  if (contrastRatio(t['--accent-text'], t['--page-bg']) < 3) w.add('--accent-text');
  if (contrastRatio('#FFFFFF', t['--accent']) < 4.5) w.add('--accent');
  if (contrastRatio(t['--accent-dark'], t['--badge-bg']) < 4.5) w.add('--accent-dark');
  if (contrastRatio(t['--ok-text'], t['--ok-bg']) < 4.5) w.add('--ok-text');
  return [...w];
}
