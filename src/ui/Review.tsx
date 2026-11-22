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
import AsyncButton from './AsyncButton';
import { TextArea, TextField } from './Field';
import { makeGenerateDeps, renderOffscreen } from './geminiDeps';
import { messageFor } from './messages';
import { Empty, Notice } from './kit';
import { StatusBadge } from './status';

type Props = { repo: GithubRepo | null; db: Db | null; draft: Draft | null; path: string | null; onGoto?: (e: 'Générer' | 'Bibliothèque') => void };
type Checks = { schema: Problem[]; lint: Problem[]; katex: string[]; overflow: number[] };

function FieldEditor({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  if (typeof value === 'string') return <TextArea label={label} rows={Math.min(8, 1 + Math.floor(value.length / 60))} value={value} onChange={(e) => onChange(e.target.value)} />;
  if (typeof value === 'number') return <TextField label={label} type="number" inputMode="numeric" value={value} onChange={(e) => onChange(Number(e.target.value))} />;
  if (Array.isArray(value) && value.every((x) => typeof x === 'string'))
    return <TextArea label={`${label} (une ligne par élément)`} rows={Math.min(8, value.length + 1)} value={value.join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} />;
  return <TextArea label={`${label} (JSON)`} rows={5} defaultValue={JSON.stringify(value, null, 2)} onBlur={(e) => { try { onChange(JSON.parse(e.target.value)); } catch { /* inchangé */ } }} />;
}

export default function Review({ repo, db, draft, path, onGoto }: Props) {
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

  const valider = async (force = false): Promise<boolean> => {
    if (!repo || !fiche) return false;
    setBusy(true); setMsg('');
    try {
      const saved = await validerFiche(repo, fiche, { baseSha, force });
      if (draft && db) await db.deleteDraft(draft.id);
      setBaseSha((await repo.readFile(saved)).sha);
      setConflict(null);
      setMsg(`Fiche validée : ${saved}`);
      return true;
    } catch (e) {
      if (e instanceof ConflictError) {
        try { setConflict((await repo.readFile(ficheSavePath(fiche))).content); } catch { setConflict('(version distante introuvable)'); }
        setMsg(messageFor(e));
      } else setMsg(messageFor(e, { source: 'github', offline: !navigator.onLine }));
      return false;
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

  if (!draft && !path) return (
    <Empty title="Rien à relire pour l’instant" action={onGoto && <div className="toolbar"><button className="btn" onClick={() => onGoto('Générer')}>Ouvrir un brouillon</button><button className="btn ghost" onClick={() => onGoto('Bibliothèque')}>Choisir une fiche</button></div>}>
      Choisis un brouillon dans Générer, ou une fiche de la Bibliothèque avec « Modifier ».
    </Empty>
  );
  if (!fiche) {
    return (
      <div className="card">
        {msg && <Notice kind="error">{msg}</Notice>}
        {draft && (
          <>
            <p>Le dernier essai n'a pas produit de fiche valide. Corrige le JSON ci-dessous puis applique-le.</p>
            {draft.problems.length > 0 && <ul>{draft.problems.map((p, i) => <li key={i}>{p.code} : {p.message}</li>)}</ul>}
            <TextArea label="JSON de la fiche" rows={14} value={raw} onChange={(e) => setRaw(e.target.value)} />
            <button className="btn" onClick={() => appliquerRaw(raw)}>Appliquer le JSON</button>
            {rawMsg && <Notice kind="error">{rawMsg}</Notice>}
          </>
        )}
      </div>
    );
  }

  const nbCoches = checked.filter(Boolean).length;
  const chk = (label: string, n: number) => <StatusBadge state={n === 0 ? 'ok' : 'failed'}>{label}</StatusBadge>;
  const reste = !peutValider && !busy
    ? bloquants > 0 ? `${bloquants} contrôle${bloquants > 1 ? 's' : ''} à corriger avant de valider.` : `Coche la checklist (${nbCoches} sur ${items.length}) pour valider.`
    : '';
  return (
    <div>
      <div className="tabs-review" style={{ display: 'flex', marginBottom: 12 }}>
        <button className="btn ghost" aria-pressed={tab === 'edit'} onClick={() => setTab('edit')}>Édition</button>
        <button className="btn ghost" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>Aperçu</button>
      </div>
      <div className="card checks" role="status" aria-label="Résultat des contrôles">
        {chk('Schéma', checks.schema.length)}
        {chk('LaTeX', checks.lint.length)}
        {chk('Formules', checks.katex.length)}
        {chk(checks.overflow.length ? `Débordement, page ${checks.overflow.join(', ')}` : 'Mise en page', checks.overflow.length)}
        {[...checks.schema, ...checks.lint].map((p, i) => <div key={i} className="detail">{p.path ? `${p.path} : ` : ''}{p.message}</div>)}
        {checks.katex.map((m, i) => <div key={i} className="detail">Formule : {m}</div>)}
      </div>
      <div className="review">
        <div className={`pane card${tab === 'edit' ? '' : ' hidden'}`}>
          {fiche.pages.map((p, i) => (
            <div key={i}>
              <h3 className="page-title">Page {i + 1}</h3>
              <FieldEditor label="Titre de la page" value={p.titre_page ?? ''} onChange={(v) => setFiche((f) => f && { ...f, pages: f.pages.map((q, qi) => (qi === i ? { ...q, titre_page: String(v) } : q)) })} />
              {p.blocks.map((b: Block, j) => (
                <fieldset key={j}>
                  <legend>{b.type}</legend>
                  {Object.entries(b).filter(([k]) => k !== 'type').map(([k, v]) => <FieldEditor key={k} label={k} value={v} onChange={(nv) => updateBlock(i, j, k, nv)} />)}
                </fieldset>
              ))}
            </div>
          ))}
          <details className="adv json">
            <summary>Modifier le JSON brut</summary>
            <TextArea label="JSON brut" rows={12} defaultValue={JSON.stringify(fiche, null, 2)} key={JSON.stringify(fiche).length}
              onBlur={(e) => appliquerRaw(e.target.value)} />
            {rawMsg && <Notice kind="error">{rawMsg}</Notice>}
          </details>
        </div>
        <div className={`pane${tab === 'preview' ? '' : ' hidden'}`}>
          <div className="export-root previewbox" ref={preview} />
        </div>
      </div>

      {msg && <Notice kind={msg.startsWith('Fiche validée') || msg.startsWith('Correction') ? 'ok' : 'error'}>{msg}</Notice>}

      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="h2" style={{ margin: '0 0 4px' }}>Avant de valider</h2>
        <p className="progress-text">{nbCoches} sur {items.length} contrôle{items.length > 1 ? 's' : ''} fait{nbCoches > 1 ? 's' : ''}</p>
        <div className="checklist">
          {items.map((it, i) => (
            <label key={it}>
              <input type="checkbox" checked={checked[i] ?? false} onChange={(e) => setChecked((c) => c.map((x, k) => (k === i ? e.target.checked : x)))} />
              <span>{it}</span>
            </label>
          ))}
        </div>
        <TextArea label="Demander une correction à Gemini" hint="Par exemple : découpe la page 3 en deux." rows={2} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        <button className="btn ghost" disabled={busy || !instruction.trim()} onClick={() => void corriger()}>Corriger avec Gemini</button>
      </div>

      <div className="actionbar">
        <div className="grow">{reste || (busy ? 'Un instant…' : <b>Prête à valider</b>)}</div>
        <div className="btns">
          <AsyncButton className="btn btn-lg" fx="shine" successLabel="Validée" disabled={!peutValider || busy} run={() => valider()}>Valider la fiche</AsyncButton>
        </div>
      </div>

      {conflict !== null && (
        <div className="card">
          <h2 className="h2" style={{ margin: '0 0 8px' }}>Cette fiche a changé ailleurs</h2>
          <p className="muted">Compare les deux versions, puis choisis laquelle garder.</p>
          <div className="diff">
            <div><b>Version sur GitHub</b><pre>{conflict}</pre></div>
            <div><b>Ma version</b><pre>{JSON.stringify(fiche, null, 2)}</pre></div>
          </div>
          <div className="toolbar" style={{ marginTop: 16, marginBottom: 0 }}>
            <button className="btn" onClick={() => void valider(true)}>Écraser avec ma version</button>
            <button className="btn ghost" onClick={() => setConflict(null)}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}
