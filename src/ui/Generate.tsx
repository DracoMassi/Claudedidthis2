import { useCallback, useEffect, useState } from 'react';
import { RequestBudget } from '../lib/gemini/budget';
import { buildPrompt } from '../lib/generate/context';
import { generateFiche } from '../lib/generate/loop';
import { loadSources } from '../lib/generate/sources';
import type { GithubRepo } from '../lib/github/repo';
import { AuthError } from '../lib/errors';
import schema from '../lib/schema/schema.json';
import { slugify } from '../lib/slug';
import { exportDraft, type Db, type Draft } from '../lib/storage/db';
import { getSettings } from '../lib/storage/settings';
import type { Brief, Fiche, Problem } from '../lib/types';
import { makeGenerateDeps } from './geminiDeps';
import { messageFor } from './messages';

type Props = { repo: GithubRepo | null; db: Db | null; initialBrief?: Brief | null; onOpenDraft: (d: Draft) => void };

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const EMPTY = { matiere: 'maths', niveau: 'mpsi', chapitre: '', sujet: '', format: 'fiche', contenu: '', pieges: '', exemples: '', nbQcm: 2, exclure: '', consignes: '' };
type Form = typeof EMPTY;

const toBrief = (f: Form): Brief => ({
  id: slugify(f.sujet) || 'brouillon', matiere: f.matiere, niveau: f.niveau, chapitre: f.chapitre, sujet: f.sujet,
  format: f.format === 'post' ? 'post' : 'fiche', contenu_obligatoire: lines(f.contenu), pieges: lines(f.pieges),
  exemples: lines(f.exemples), nb_qcm: f.nbQcm, exclure: lines(f.exclure), ...(f.consignes ? { consignes: f.consignes } : {}),
});
const fromBrief = (b: Brief): Form => ({
  matiere: b.matiere, niveau: b.niveau, chapitre: b.chapitre, sujet: b.sujet, format: b.format ?? 'fiche',
  contenu: (b.contenu_obligatoire ?? []).join('\n'), pieges: (b.pieges ?? []).join('\n'), exemples: (b.exemples ?? []).join('\n'),
  nbQcm: b.nb_qcm ?? 2, exclure: (b.exclure ?? []).join('\n'), consignes: b.consignes ?? '',
});

export function downloadText(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export default function Generate({ repo, db, initialBrief, onOpenDraft }: Props) {
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [tour, setTour] = useState(0);
  const [msg, setMsg] = useState('');
  const [problems, setProblems] = useState<Problem[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [used, setUsed] = useState('');

  const refresh = useCallback(async () => {
    if (db) setDrafts(await db.listDrafts());
    const s = getSettings();
    const u = new RequestBudget({ perMinute: s.maxPerMinute, perDay: s.maxPerDay }, undefined, 'sequentia.budget').used();
    setUsed(`${u.day}/${u.limit}`);
  }, [db]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (initialBrief) setF(fromBrief(initialBrief)); }, [initialBrief]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const importBrief = async (file: File | undefined) => {
    if (!file) return;
    try { setF(fromBrief(JSON.parse(await file.text()) as Brief)); setMsg(''); }
    catch { setMsg("Ce fichier n'est pas un brief JSON valide"); }
  };

  const run = async () => {
    const s = getSettings();
    if (!s.geminiKey) { setMsg(messageFor(new AuthError())); return; }
    if (!repo || !db) { setMsg('Ajoute ton jeton GitHub, le propriétaire et le nom du dépôt dans Réglages'); return; }
    if (!f.sujet.trim() || !f.chapitre.trim()) { setMsg('Renseigne au moins le chapitre et le sujet'); return; }
    setBusy(true); setMsg(''); setProblems([]); setTour(0);
    try {
      await document.fonts?.ready;
      const brief = toBrief(f);
      let src;
      try { src = await loadSources(repo, db, brief); }
      catch (e) { setMsg(messageFor(e, { source: 'github' })); return; }
      const prompt = buildPrompt({ charte: src.charte, schema: schema as object, examples: src.examples, sections: src.sections, brief });
      const result = await generateFiche(brief, prompt, makeGenerateDeps(s, prompt.system, setTour));
      const fiche: Fiche | null = result.fiche
        ? { ...result.fiche, meta: { ...result.fiche.meta, statut: 'a_verifier', brief, format: result.fiche.meta.format ?? brief.format ?? 'fiche' } }
        : null;
      const draft: Draft = { id: brief.id, fiche, raw: result.last, brief, problems: result.problems, updatedAt: Date.now() };
      await db.putDraft(draft);
      setProblems(result.problems);
      if (result.error) setMsg(messageFor(result.error));
      else if (!result.ok) setMsg("La fiche n'a pas passé tous les contrôles. Le dernier essai est gardé dans les brouillons");
      else setMsg(`Brouillon prêt après ${result.tours} tour${result.tours > 1 ? 's' : ''}`);
      await refresh();
    } catch (e) {
      setMsg(messageFor(e));
    } finally { setBusy(false); }
  };

  const field = (label: string, el: JSX.Element) => <label style={{ display: 'block', margin: '8px 0' }}>{label}{el}</label>;
  const input = { style: { display: 'block', width: '100%', padding: 8 } };

  return (
    <div>
      <div className="card">
        <label>Importer un brief (.json) <input type="file" accept="application/json,.json" onChange={(e) => void importBrief(e.target.files?.[0])} /></label>
        {field('Matière', <select {...input} value={f.matiere} onChange={(e) => set('matiere', e.target.value)}>{['maths', 'physique', 'chimie', 'si', 'philosophie', 'histoire'].map((m) => <option key={m}>{m}</option>)}</select>)}
        {field('Niveau', <select {...input} value={f.niveau} onChange={(e) => set('niveau', e.target.value)}><option>mpsi</option><option>terminale</option></select>)}
        {field('Format', <select {...input} value={f.format} onChange={(e) => set('format', e.target.value)}><option value="fiche">Fiche A4</option><option value="post">Post 4:5</option></select>)}
        {field('Chapitre', <input {...input} value={f.chapitre} onChange={(e) => set('chapitre', e.target.value)} />)}
        {field('Sujet', <input {...input} value={f.sujet} onChange={(e) => set('sujet', e.target.value)} />)}
        {field('Contenu obligatoire (une ligne par point)', <textarea {...input} rows={4} value={f.contenu} onChange={(e) => set('contenu', e.target.value)} />)}
        {field('Pièges (une ligne par point)', <textarea {...input} rows={3} value={f.pieges} onChange={(e) => set('pieges', e.target.value)} />)}
        {field('Exemples (une ligne par point)', <textarea {...input} rows={2} value={f.exemples} onChange={(e) => set('exemples', e.target.value)} />)}
        {field('Nombre de QCM', <input style={{ display: 'block', width: 100, padding: 8 }} type="number" min={0} value={f.nbQcm} onChange={(e) => set('nbQcm', Math.max(0, Number(e.target.value) || 0))} />)}
        {field('À exclure (une ligne par point)', <textarea {...input} rows={2} value={f.exclure} onChange={(e) => set('exclure', e.target.value)} />)}
        {field('Consignes', <textarea {...input} rows={2} value={f.consignes} onChange={(e) => set('consignes', e.target.value)} />)}
        <button disabled={busy} onClick={() => void run()} style={{ padding: '8px 16px' }}>{busy ? `Tour ${tour} sur 4…` : 'Générer'}</button>
        <span style={{ marginLeft: 12 }}>Requêtes aujourd'hui : {used}</span>
      </div>
      {msg && <p role="status">{msg}</p>}
      {problems.length > 0 && <ul>{problems.map((p, i) => <li key={i}>{p.code}{p.path ? ` ${p.path}` : ''} : {p.message}</li>)}</ul>}
      <h2 className="titre" style={{ fontSize: 24 }}>Brouillons</h2>
      {drafts.length === 0 && <div className="card">Aucun brouillon.</div>}
      {drafts.map((d) => (
        <div key={d.id} className="card" style={{ marginBottom: 8 }}>
          <b>{d.fiche?.meta.titre ?? d.id}</b> {d.fiche ? <span className="badge">à vérifier</span> : <span className="badge">échec, dernier essai</span>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button onClick={() => onOpenDraft(d)}>Relire</button>
            <button onClick={() => downloadText(`${d.id}.json`, exportDraft(d))}>Exporter le JSON</button>
            <button onClick={async () => { await db?.deleteDraft(d.id); await refresh(); }}>Supprimer</button>
          </div>
        </div>
      ))}
    </div>
  );
}
