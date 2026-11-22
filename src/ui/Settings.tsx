import { useState } from 'react';
import AsyncButton from './AsyncButton';
import { TextField } from './Field';
import ThemeSettings from './ThemeSettings';
import { Notice, Section } from './kit';
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
  const text = (k: 'geminiKey' | 'githubToken' | 'owner' | 'repo' | 'model' | 'modelSecours', label: string, secret = false) => (
    <TextField label={label} type={secret ? 'password' : 'text'} autoComplete="off" value={s[k]} onChange={(e) => set(k, e.target.value)} />
  );
  const num = (k: 'maxPerMinute' | 'maxPerDay' | 'lotPages', label: string) => (
    <TextField label={label} type="number" min={1} inputMode="numeric" value={s[k]} onChange={(e) => set(k, Math.max(1, Number(e.target.value) || 1))} />
  );
  const ok = msg.endsWith('connecté');
  return (
    <>
      <div className="card">
        <Section title="Connexions" hint="Ces valeurs restent sur cet appareil. Teste chaque connexion après l’avoir saisie.">
          <div className="grid2">
            {text('geminiKey', 'Clé Gemini', true)}
            {text('githubToken', 'Jeton GitHub (limité au dépôt Fiches)', true)}
            {text('owner', 'Propriétaire du dépôt')}
            {text('repo', 'Nom du dépôt')}
          </div>
          <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
            <AsyncButton className="btn ghost" successLabel="Connecté" run={async () => { const r = await testGithub(s); setMsg(r); return r.endsWith('connecté'); }}>Tester GitHub</AsyncButton>
            <AsyncButton className="btn ghost" successLabel="Connecté" run={async () => { const r = await testGemini(s); setMsg(r); return r.endsWith('connecté'); }}>Tester Gemini</AsyncButton>
            <span className="sp" />
            <button className="btn ghost" onClick={() => { clearKeys(); setS(getSettings()); setMsg('Clés effacées'); }}>Effacer mes clés</button>
          </div>
          {msg && <Notice kind={ok ? 'ok' : msg === 'Clés effacées' ? 'info' : 'error'}>{msg}</Notice>}
        </Section>

        <Section title="Modèle" hint="Le modèle de secours ne sert que si le principal reste surchargé.">
          <div className="grid2">
            {text('model', 'Modèle Gemini')}
            {text('modelSecours', 'Modèle de secours (optionnel)')}
          </div>
        </Section>

        <Section title="Limites" hint="Elles évitent de dépasser ton quota Gemini.">
          <div className="grid3">
            {num('maxPerMinute', 'Requêtes par minute')}
            {num('maxPerDay', 'Requêtes par jour')}
            {num('lotPages', 'Pages par lot (cours)')}
          </div>
        </Section>
      </div>
      <ThemeSettings />
    </>
  );
}
