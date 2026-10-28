import { useEffect, useRef, useState } from 'react';
import { ConflictError } from '../lib/errors';
import { extractJson } from '../lib/gemini/json';
import { buildPrompt } from '../lib/generate/context';
import { loadSources } from '../lib/generate/sources';
import type { GithubRepo } from '../lib/github/repo';
import { canValidate, parseChecklist } from '../lib/relire/checklist';
import { correctFiche, ficheSavePath, validerFiche } from '../lib/relire/valider';
import { renderFiche } from '../lib/render/renderFiche';
import schema from '../lib/schema/schema.json';
import { lintLatex } from '../lib/schema/lint';
import { validateFiche } from '../lib/schema/validate';
import type { Db, Draft } from '../lib/storage/db';
import { getSettings } from '../lib/storage/settings';
import type { Block, Brief, Fiche, Problem } from '../lib/types';
import { makeGenerateDeps, renderOffscreen } from './geminiDeps';
import { messageFor } from './messages';

type Props = { repo: GithubRepo | null; db: Db | null; draft: Draft | null; path: string | null };
type Checks = { schema: Problem[]; lint: Problem[]; katex: string[]; overflow: number[] };

function FieldEditor({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const box = { style: { display: 'block', width: '100%', padding: 6 } };
  if (typeof value === 'string') return <label>{label}<textarea {...box} rows={Math.min(8, 1 + Math.floor(value.length / 60))} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
  if (typeof value === 'number') return <label>{label}<input {...box} type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>;
  if (Array.isArray(value) && value.every((x) => typeof x === 'string'))
    return <label>{label} (une ligne par élément)<textarea {...box} rows={Math.min(8, value.length + 1)} value={value.join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} /></label>;
  return <label>{label} (JSON)<textarea {...box} rows={5} defaultValue={JSON.stringify(value, null, 2)} onBlur={(e) => { try { onChange(JSON.parse(e.target.value)); } catch { /* inchangé */ } }} /></label>;
}

export default function Review({ repo, db, draft, path }: Props) {
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [baseSha, setBaseSha] = useState<string | undefined>();
  const [items, setItems] = useState<string[]>(parseChecklist(''));
  const [checked, setChecked] = useState<boolean[]>([]);
  const [checks, setChecks] = useState<Checks>({ schema: [], lint: [], katex: [], overflow: [] });
  const [raw, setRaw] = useState('');
  const [rawMsg, setRawMsg] = useState('');
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);
  const preview = useRef<HTMLDivElement>(null);

  useEffect(() => { setChecked(items.map(() => false)); }, [items]);
  useEffect(() => {
    if (!repo) return;
    repo.readFile('charte.md').then((r) => setItems(parseChecklist(r.content)), () => setItems(parseChecklist('')));
  }, [repo]);

  useEffect(() => {
    setMsg(''); setConflict(null); setBaseSha(undefined);
    if (draft) { setFiche(draft.fiche); setRaw(draft.fiche ? '' : draft.raw ?? ''); return; }
    if (path && repo) {
      repo.readFile(path).then((r) => { setFiche(JSON.parse(r.content) as Fiche); setBaseSha(r.sha); }, (e) => setMsg(messageFor(e, { source: 'github' })));
    } else setFiche(null);
  }, [draft, path, repo]);

  useEffect(() => {
    if (!fiche) return;
    // Contrôles mesurés hors écran : l'aperçu peut être masqué (onglets en portrait) et un élément masqué n'a pas de hauteur.
    const mesure = renderOffscreen(fiche);
    setChecks({ schema: validateFiche(fiche), lint: lintLatex(fiche), katex: mesure.katexErrors, overflow: mesure.overflow });
    if (preview.current) renderFiche(preview.current, fiche);
  }, [fiche]);

  const updateBlock = (i: number, j: number, key: string, value: unknown) =>
    setFiche((f) => f && { ...f, pages: f.pages.map((p, pi) => (pi !== i ? p : { ...p, blocks: p.blocks.map((b, bj) => (bj !== j ? b : { ...b, [key]: value })) })) });

  const bloquants = checks.schema.length + checks.lint.length + checks.katex.length;
  const peutValider = !!repo && !!fiche && canValidate(checked) && bloquants === 0;

  const valider = async (force = false) => {
    if (!repo || !fiche) return;
    setBusy(true); setMsg('');
    try {
      const saved = await validerFiche(repo, fiche, { baseSha, force });
      if (draft && db) await db.deleteDraft(draft.id);
      setBaseSha((await repo.readFile(saved)).sha);
      setConflict(null);
      setMsg(`Fiche validée : ${saved}`);
    } catch (e) {
      if (e instanceof ConflictError) {
        try { setConflict((await repo.readFile(ficheSavePath(fiche))).content); } catch { setConflict('(version distante introuvable)'); }
        setMsg(messageFor(e));
      } else setMsg(messageFor(e, { source: 'github', offline: !navigator.onLine }));
    } finally { setBusy(false); }
  };

  const corriger = async () => {
    const s = getSettings();
    if (!fiche || !repo || !db || !instruction.trim()) return;
    if (!s.geminiKey) { setMsg('Ajoute ta clé Gemini dans Réglages'); return; }
    setBusy(true); setMsg('');
    try {
      const brief: Brief = fiche.meta.brief ?? { id: 'correction', matiere: fiche.meta.matiere, niveau: fiche.meta.niveau, chapitre: fiche.meta.chapitre, sujet: fiche.meta.titre };
      const src = await loadSources(repo, db, brief);
      const prompt = buildPrompt({ charte: src.charte, schema: schema as object, examples: src.examples, sections: src.sections, brief });
      const r = await correctFiche(fiche, instruction, prompt, makeGenerateDeps(s, prompt.system, () => undefined));
      if (r.ok && r.fiche) {
        setFiche({ ...r.fiche, meta: { ...r.fiche.meta, brief: fiche.meta.brief ?? r.fiche.meta.brief, statut: fiche.meta.statut } });
        setMsg('Correction appliquée. Relis avant de valider');
      } else setMsg(r.error ? messageFor(r.error) : `La correction n'a pas passé les contrôles : ${r.problems.map((p) => p.message).join(' ; ')}`);
    } catch (e) { setMsg(messageFor(e)); } finally { setBusy(false); }
  };

  const appliquerRaw = (text: string) => {
    try {
      const d = extractJson(text) as Fiche;
      if (!d || !Array.isArray(d.pages)) throw new Error('pas une fiche');
      setFiche(d); setRawMsg('');
    } catch { setRawMsg('JSON invalide : impossible de l’appliquer'); }
  };

  if (!draft && !path) return <div className="card">Choisis un brouillon dans Générer, ou une fiche dans la Bibliothèque (Modifier).</div>;
  if (!fiche) {
    return (
      <div className="card">
        {msg && <p role="alert">{msg}</p>}
        {draft && (
          <>
            <p>Le dernier essai n'a pas produit de fiche valide. Corrige le JSON ci-dessous puis applique-le.</p>
            {draft.problems.length > 0 && <ul>{draft.problems.map((p, i) => <li key={i}>{p.code} : {p.message}</li>)}</ul>}
            <textarea style={{ width: '100%', padding: 8 }} rows={14} value={raw} onChange={(e) => setRaw(e.target.value)} />
            <button onClick={() => appliquerRaw(raw)}>Appliquer le JSON</button>
            {rawMsg && <p role="alert">{rawMsg}</p>}
          </>
        )}
      </div>
    );
  }

  const etat = (ok: boolean) => (ok ? '✓' : '✗');
  return (
    <div>
      <div className="tabs-review" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button aria-pressed={tab === 'edit'} onClick={() => setTab('edit')}>Édition</button>
        <button aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>Aperçu</button>
      </div>
      <div className="card" style={{ marginBottom: 8 }}>
        Contrôles : schéma {etat(checks.schema.length === 0)} · lint {etat(checks.lint.length === 0)} · KaTeX {etat(checks.katex.length === 0)} · débordement {etat(checks.overflow.length === 0)}{checks.overflow.length > 0 && ` (pages ${checks.overflow.join(', ')})`}
        {[...checks.schema, ...checks.lint].map((p, i) => <div key={i} style={{ fontSize: 13 }}>{p.code} {p.path} : {p.message}</div>)}
        {checks.katex.map((m, i) => <div key={i} style={{ fontSize: 13 }}>katex : {m}</div>)}
      </div>
      <div className="review">
        <div className={`pane card${tab === 'edit' ? '' : ' hidden'}`}>
          {fiche.pages.map((p, i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <h3>Page {i + 1}</h3>
              <FieldEditor label="Titre de la page" value={p.titre_page ?? ''} onChange={(v) => setFiche((f) => f && { ...f, pages: f.pages.map((q, qi) => (qi === i ? { ...q, titre_page: String(v) } : q)) })} />
              {p.blocks.map((b: Block, j) => (
                <fieldset key={j} style={{ margin: '8px 0' }}>
                  <legend>{b.type}</legend>
                  {Object.entries(b).filter(([k]) => k !== 'type').map(([k, v]) => <FieldEditor key={k} label={k} value={v} onChange={(nv) => updateBlock(i, j, k, nv)} />)}
                </fieldset>
              ))}
            </div>
          ))}
          <details>
            <summary>JSON brut</summary>
            <textarea style={{ width: '100%', padding: 8 }} rows={12} defaultValue={JSON.stringify(fiche, null, 2)} key={JSON.stringify(fiche).length}
              onBlur={(e) => appliquerRaw(e.target.value)} />
            {rawMsg && <p role="alert">{rawMsg}</p>}
          </details>
        </div>
        <div className={`pane${tab === 'preview' ? '' : ' hidden'}`}>
          <div ref={preview} style={{ overflow: 'auto', maxWidth: '100%' }} />
        </div>
      </div>
      <div className="card" style={{ marginTop: 8 }}>
        <p style={{ marginTop: 0 }}>Checklist de relecture</p>
        {items.map((it, i) => (
          <label key={it} style={{ display: 'block' }}>
            <input type="checkbox" checked={checked[i] ?? false} onChange={(e) => setChecked((c) => c.map((x, k) => (k === i ? e.target.checked : x)))} /> {it}
          </label>
        ))}
        <textarea placeholder="Consigne pour Gemini (par exemple : découpe la page 3)" style={{ width: '100%', padding: 8, marginTop: 8 }} rows={2} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button disabled={busy || !instruction.trim()} onClick={() => void corriger()}>Corriger avec Gemini</button>
          <button disabled={!peutValider || busy} onClick={() => void valider()} style={{ background: 'var(--accent)', color: '#fff', border: 0, borderRadius: 8, padding: '6px 14px' }}>Valider</button>
        </div>
        {!peutValider && <p style={{ fontSize: 13 }}>Valider s'active quand toutes les cases sont cochées et que schéma, lint et KaTeX sont au vert.</p>}
        {msg && <p role="status">{msg}</p>}
      </div>
      {conflict !== null && (
        <div className="card" style={{ marginTop: 8 }}>
          <p>Cette fiche a changé ailleurs. Compare puis choisis.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div><b>Version distante</b><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{conflict}</pre></div>
            <div><b>Ma version</b><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(fiche, null, 2)}</pre></div>
          </div>
          <button onClick={() => void valider(true)}>Écraser</button> <button onClick={() => setConflict(null)}>Annuler</button>
        </div>
      )}
    </div>
  );
}
