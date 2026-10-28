import { useState } from 'react';
import ThemeSettings from './ThemeSettings';
import { clearKeys, getSettings, saveSettings, type Settings as S } from '../lib/storage/settings';

async function testGithub(s: S): Promise<string> {
  try {
    const r = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}`, {
      headers: { Authorization: `Bearer ${s.githubToken}`, Accept: 'application/vnd.github+json' },
    });
    if (r.ok) return 'GitHub : connecté';
    if (r.status === 401) return 'Jeton refusé ou expiré. Crée-en un nouveau (voir le README)';
    if (r.status === 404) return 'Dépôt introuvable, ou jeton sans accès à ce dépôt';
    return `GitHub a répondu ${r.status}`;
  } catch {
    return "GitHub n'a pas répondu. Réessayer";
  }
}
async function testGemini(s: S): Promise<string> {
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(s.geminiKey)}`);
    if (r.ok) return 'Gemini : connecté';
    if (r.status === 400 || r.status === 403) return 'Clé refusée. Ajoute ta clé Gemini dans Réglages';
    return `Gemini a répondu ${r.status}`;
  } catch {
    return "Gemini n'a pas répondu. Réessayer"; // une erreur CORS peut masquer un 503 : jamais « clé invalide »
  }
}

export default function Settings() {
  const [s, setS] = useState<S>(getSettings());
  const [msg, setMsg] = useState('');
  const set = <K extends keyof S>(k: K, v: S[K]) => { saveSettings({ [k]: v } as Partial<S>); setS(getSettings()); window.dispatchEvent(new Event('sequentia-settings-changed')); };
  const text = (k: 'geminiKey' | 'githubToken' | 'owner' | 'repo' | 'model', label: string, secret = false) => (
    <label style={{ display: 'block', margin: '8px 0' }}>
      {label}
      <input style={{ display: 'block', width: '100%', padding: 8 }} type={secret ? 'password' : 'text'} autoComplete="off"
        value={s[k]} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  const num = (k: 'maxPerMinute' | 'maxPerDay' | 'lotPages', label: string) => (
    <label style={{ display: 'block', margin: '8px 0' }}>
      {label}
      <input style={{ display: 'block', width: 120, padding: 8 }} type="number" min={1}
        value={s[k]} onChange={(e) => set(k, Math.max(1, Number(e.target.value) || 1))} />
    </label>
  );
  return (
    <>
    <div className="card">
      {text('geminiKey', 'Clé Gemini', true)}
      {text('githubToken', 'Jeton GitHub (limité au dépôt Fiches)', true)}
      {text('owner', 'Propriétaire du dépôt')}
      {text('repo', 'Nom du dépôt')}
      {text('model', 'Modèle Gemini')}
      {num('maxPerMinute', 'Requêtes par minute')}
      {num('maxPerDay', 'Requêtes par jour')}
      {num('lotPages', 'Pages par lot (import de cours)')}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button onClick={async () => setMsg(await testGithub(s))}>Tester la connexion GitHub</button>
        <button onClick={async () => setMsg(await testGemini(s))}>Tester la connexion Gemini</button>
        <button onClick={() => { clearKeys(); setS(getSettings()); setMsg('Clés effacées'); }}>Effacer mes clés</button>
      </div>
      {msg && <p role="status">{msg}</p>}
    </div>
    <ThemeSettings />
    </>
  );
}
