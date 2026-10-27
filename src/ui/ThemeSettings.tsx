import { useState } from 'react';
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
    <div className="card" style={{ marginTop: 16 }}>
      <h2 className="titre" style={{ fontSize: 24 }}>Thème</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(Object.keys(THEMES) as ThemeId[]).map((id) => (
          <button key={id} aria-pressed={s.theme === id} onClick={() => update({ theme: id })}
            style={{ padding: 8, borderRadius: 12, border: '1px solid var(--card-border)', background: THEMES[id].light['--page-bg'], color: '#1B1B1B', outline: s.theme === id ? '2px solid var(--accent)' : 'none' }}>
            {THEMES[id].label}
          </button>
        ))}
      </div>
      <p style={{ marginBottom: 4 }}>Mode</p>
      <div style={{ display: 'flex', gap: 8 }}>
        {(['auto', 'clair', 'sombre'] as Mode[]).map((m) => (
          <button key={m} aria-pressed={s.mode === m} onClick={() => update({ mode: m })}
            style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid var(--card-border)', background: s.mode === m ? 'var(--accent)' : 'transparent', color: s.mode === m ? '#fff' : 'var(--text)' }}>
            {m === 'auto' ? 'Auto' : m === 'clair' ? 'Clair' : 'Sombre'}
          </button>
        ))}
      </div>
      <p style={{ marginBottom: 4 }}>Couleurs ({resolved === 'light' ? 'mode clair' : 'mode sombre'})</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {COULEURS.map((c) => (
          <label key={c.label}>
            {c.label}
            <input type="color" style={{ display: 'block' }} value={tokens[c.tokens[0]].startsWith('#') ? tokens[c.tokens[0]] : '#ffffff'}
              onChange={(e) => setColor(c.tokens, e.target.value.toUpperCase())} />
          </label>
        ))}
      </div>
      {warnings.length > 0 && (
        <p role="alert" style={{ color: 'var(--accent-text)' }}>Contraste faible : {warnings.map((w) => NOMS_FR[w] ?? w).join(', ')}</p>
      )}
      <button style={{ marginTop: 12 }} onClick={() => update({ themeOverrides: {} })}>Réinitialiser le thème</button>
    </div>
  );
}
