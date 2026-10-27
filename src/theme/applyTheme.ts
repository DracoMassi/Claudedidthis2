import { THEMES, TOKEN_NAMES, type Mode, type ThemeId, type Tokens } from './themes';

export type ThemeSelection = {
  theme: ThemeId; mode: Mode; overrides: { light?: Partial<Tokens>; dark?: Partial<Tokens> };
};

export const resolveMode = (mode: Mode, prefersDark: boolean): 'light' | 'dark' =>
  mode === 'clair' ? 'light' : mode === 'sombre' ? 'dark' : prefersDark ? 'dark' : 'light';

export function effectiveTokens(s: ThemeSelection, resolved: 'light' | 'dark'): Tokens {
  const base = (THEMES[s.theme] ?? THEMES.ac)[resolved];
  return { ...base, ...(resolved === 'light' ? s.overrides.light : s.overrides.dark) };
}

export function applyTheme(root: HTMLElement, s: ThemeSelection, prefersDark: boolean): void {
  const resolved = resolveMode(s.mode, prefersDark);
  const tokens = effectiveTokens(s, resolved);
  for (const n of TOKEN_NAMES) root.style.setProperty(n, tokens[n]);
  root.style.setProperty('color-scheme', resolved);
  root.setAttribute('data-mode', resolved);
}
