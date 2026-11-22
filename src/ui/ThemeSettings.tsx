import { useState } from 'react';
import { Notice, Section } from './kit';
import { getSettings, saveSettings } from '../lib/storage/settings';
import { THEMES, contrastWarnings, effectiveTokens, resolveMode, type Mode, type ThemeId, type TokenName } from '../theme/themes';

const COULEURS: { label: string; tokens: TokenName[] }[] = [
  { label: 'Fond', tokens: ['--page-bg'] },
  { label: 'Cartes', tokens: ['--card'] },
  { label: 'Accent', tokens: ['--accent', '--accent-text'] },
  { label: 'Texte', tokens: ['--text'] },
  { label: 'Logo', tokens: ['--logo'] },
];
const NOMS_FR: Record<string, string> = {
  '--text': 'texte', '--accent-text': 'titres rouges', '--accent': 'bouton', '--accent-dark': 'texte des pastilles', '--ok-text': 'pastille validée',
};
const notify = () => window.dispatchEvent(new Event('sequentia-settings-changed'));

export default function ThemeSettings() {
  const [s, setS] = useState(getSettings());
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const resolved = resolveMode(s.mode, prefersDark);
  const sel = { theme: s.theme as ThemeId, mode: s.mode as Mode, overrides: s.themeOverrides };
  const tokens = effectiveTokens(sel, resolved);
  const warnings = contrastWarnings(tokens);
  const update = (patch: Parameters<typeof saveSettings>[0]) => { saveSettings(patch); setS(getSettings()); notify(); };
  const setColor = (names: TokenName[], value: string) => {
    const key = resolved === 'light' ? 'light' : 'dark';
    const cur = { ...(s.themeOverrides[key] ?? {}) };
    for (const n of names) cur[n] = value;
    update({ themeOverrides: { ...s.themeOverrides, [key]: cur } });
  };
  return (
    <div className="card">
      <Section title="Apparence" hint="Le thème change l’app, pas le rendu des fiches : elles gardent leur charte.">
        <div className="swatches" role="group" aria-label="Thème">
          {(Object.keys(THEMES) as ThemeId[]).map((id) => (
            <button key={id} className="swatch" aria-pressed={s.theme === id} onClick={() => update({ theme: id })}>
              <i style={{ backgroundColor: THEMES[id].light['--page-bg'], ...(THEMES[id].light['--grid-line'] !== 'transparent' ? { backgroundImage: `linear-gradient(to right, ${THEMES[id].light['--grid-line']} 1px, transparent 1px), linear-gradient(to bottom, ${THEMES[id].light['--grid-line']} 1px, transparent 1px)`, backgroundSize: '9px 9px' } : {}), ['--sw-accent' as string]: THEMES[id].light['--accent'] }} />
              {THEMES[id].label}
            </button>
          ))}
        </div>
        <h3 style={{ margin: '24px 0 8px', fontSize: 15 }}>Mode</h3>
        <div className="segmented" role="group" aria-label="Mode">
          {(['auto', 'clair', 'sombre'] as Mode[]).map((m) => (
            <button key={m} aria-pressed={s.mode === m} onClick={() => update({ mode: m })}>{m === 'auto' ? 'Auto' : m === 'clair' ? 'Clair' : 'Sombre'}</button>
          ))}
        </div>
        <h3 style={{ margin: '24px 0 8px', fontSize: 15 }}>Couleurs <span className="muted" style={{ fontWeight: 400 }}>({resolved === 'light' ? 'mode clair' : 'mode sombre'})</span></h3>
        <div className="colors">
          {COULEURS.map((c) => (
            <label key={c.label}>
              {c.label}
              <input type="color" value={tokens[c.tokens[0]].startsWith('#') ? tokens[c.tokens[0]] : '#ffffff'}
                onChange={(e) => setColor(c.tokens, e.target.value.toUpperCase())} />
            </label>
          ))}
        </div>
        {warnings.length > 0 && <Notice kind="error">Contraste faible sur : {warnings.map((w) => NOMS_FR[w] ?? w).join(', ')}. Le texte pourrait être difficile à lire.</Notice>}
        <div className="toolbar" style={{ marginTop: 20, marginBottom: 0 }}><button onClick={() => update({ themeOverrides: {} })}>Réinitialiser le thème</button></div>
      </Section>
    </div>
  );
}
