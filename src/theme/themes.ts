export type TokenName =
  | '--page-bg' | '--grid-line' | '--card' | '--card-border' | '--accent' | '--accent-text'
  | '--accent-dark' | '--logo' | '--badge-bg' | '--ok-bg' | '--ok-text' | '--text';
export type Tokens = Record<TokenName, string>;
export type ThemeId = 'ac' | 'a' | 'b' | 'c';
export type Mode = 'auto' | 'clair' | 'sombre';

export const TOKEN_NAMES: TokenName[] = [
  '--page-bg', '--grid-line', '--card', '--card-border', '--accent', '--accent-text',
  '--accent-dark', '--logo', '--badge-bg', '--ok-bg', '--ok-text', '--text',
];

// Valeurs de la spec §8.
const acLight: Tokens = {
  '--page-bg': '#F8E8EC', '--grid-line': '#EFCDD5', '--card': '#FFFFFF', '--card-border': '#E4B9C2',
  '--accent': '#DD0033', '--accent-text': '#DD0033', '--accent-dark': '#7C011D', '--logo': '#A8586B',
  '--badge-bg': '#F3D9DF', '--ok-bg': '#E3F0DC', '--ok-text': '#27500A', '--text': '#1B1B1B',
};
const acDark: Tokens = {
  '--page-bg': '#1F1418', '--grid-line': '#2B1C22', '--card': '#2A1B21', '--card-border': '#4A2F38',
  '--accent': '#DD0033', '--accent-text': '#FF6B85', '--accent-dark': '#F3B7C4', '--logo': '#CB8593',
  '--badge-bg': '#4A2230', '--ok-bg': '#1F3A1A', '--ok-text': '#A8D890', '--text': '#F3E6E9',
};

export const THEMES: Record<ThemeId, { label: string; light: Tokens; dark: Tokens }> = {
  ac: { label: 'A+C (quadrillé rose)', light: acLight, dark: acDark },
  a: { label: 'A : quadrillé blanc', light: { ...acLight, '--page-bg': '#FFFFFF', '--grid-line': '#EBD2D8', '--logo': '#CB8593' }, dark: acDark },
  b: {
    label: 'B : épuré',
    light: { ...acLight, '--page-bg': '#FFFFFF', '--grid-line': 'transparent', '--card-border': '#E6E6E6', '--logo': '#CB8593' },
    dark: { ...acDark, '--grid-line': 'transparent' },
  },
  c: { label: 'C : rose poudré', light: { ...acLight, '--grid-line': 'transparent' }, dark: { ...acDark, '--grid-line': 'transparent' } },
};

export * from './contrast';
export * from './applyTheme';
