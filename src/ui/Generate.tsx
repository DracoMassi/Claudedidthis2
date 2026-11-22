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
import { AttemptLog } from './status';
import { TextArea, SelectField, TextField } from './Field';
import { FxButton } from './fx';
import { messageFor } from './messages';
import { Empty, Notice, Quota, Section, Stepper } from './kit';

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
  const [live, setLive] = useState('');

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
      const result = await generateFiche(brief, prompt, makeGenerateDeps(s, prompt.system, setTour, (e) => setLive(e.message)));
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
    } finally { setBusy(false); setLive(''); }
  };

  const MATIERES = ['maths', 'physique', 'chimie', 'si', 'philosophie', 'histoire'];
  const pret = f.sujet.trim() && f.chapitre.trim();
  const ok = msg.startsWith('Brouillon prêt');

  return (
    <div>
      <div className="card">
        <label className="drop">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
          <div><b>Reprendre un brief existant</b><span>Choisis un fichier .json pour remplir le formulaire</span></div>
          <input type="file" accept="application/json,.json" onChange={(e) => void importBrief(e.target.files?.[0])} />
        </label>

        <Section title="Le sujet" hint="Ces deux champs sont obligatoires.">
          <div className="grid3">
            <SelectField label="Matière" value={f.matiere} onChange={(e) => set('matiere', e.target.value)}>{MATIERES.map((m) => <option key={m}>{m}</option>)}</SelectField>
            <SelectField label="Niveau" value={f.niveau} onChange={(e) => set('niveau', e.target.value)}><option>mpsi</option><option>terminale</option></SelectField>
            <SelectField label="Format" value={f.format} onChange={(e) => set('format', e.target.value)}><option value="fiche">Fiche A4</option><option value="post">Post 4:5</option></SelectField>
          </div>
          <div className="grid2">
            <TextField label="Chapitre" required value={f.chapitre} onChange={(e) => set('chapitre', e.target.value)} />
            <TextField label="Sujet de la fiche" required value={f.sujet} onChange={(e) => set('sujet', e.target.value)} />
          </div>
        </Section>

        <Section title="Ce que la fiche doit contenir" hint="Une idée par ligne. Plus c’est précis, moins il y a de tours de correction.">
          <TextArea label="Points obligatoires" rows={4} value={f.contenu} onChange={(e) => set('contenu', e.target.value)} />
          <div className="grid2">
            <TextArea label="Pièges à signaler" rows={3} value={f.pieges} onChange={(e) => set('pieges', e.target.value)} />
            <TextArea label="Exemples à inclure" rows={3} value={f.exemples} onChange={(e) => set('exemples', e.target.value)} />
          </div>
          <TextField label="Nombre de QCM" type="number" min={0} inputMode="numeric" fieldStyle={{ maxWidth: 260 }} value={f.nbQcm} onChange={(e) => set('nbQcm', Math.max(0, Number(e.target.value) || 0))} />
        </Section>

        <details className="adv" open={!!(f.exclure || f.consignes)}>
          <summary>Options avancées</summary>
          <TextArea label="À exclure" rows={2} hint="Notions à ne pas aborder, une par ligne." value={f.exclure} onChange={(e) => set('exclure', e.target.value)} />
          <TextArea label="Consignes de style" rows={2} value={f.consignes} onChange={(e) => set('consignes', e.target.value)} />
        </details>
      </div>

      {msg && !busy && <Notice kind={ok ? 'ok' : problems.length || msg.startsWith('La fiche') ? 'error' : 'info'}>{msg}</Notice>}
      {problems.length > 0 && !busy && (
        <details className="adv" style={{ marginTop: -8, marginBottom: 20 }}>
          <summary>{problems.length} point{problems.length > 1 ? 's' : ''} à corriger dans la fiche</summary>
          <ul>{problems.map((p, i) => <li key={i}>{p.code}{p.path ? ` ${p.path}` : ''} : {p.message}</li>)}</ul>
        </details>
      )}

      <div className="actionbar">
        <div className="grow" role="status" aria-live="polite">
          {busy ? (
            <>
              <b>{live || `Tour ${Math.max(tour, 1)} sur 4`}</b>
              <Stepper current={Math.max(tour, 1)} total={4} label={`Tour ${tour} sur 4`} />
            </>
          ) : pret ? <Quota used={used} /> : <span>Renseigne le chapitre et le sujet pour lancer la génération.</span>}
        </div>
        <div className="btns">
          <FxButton fx="magnetic" className="btn btn-lg" disabled={busy || !pret} onClick={() => void run()}>{busy ? 'Génération en cours…' : 'Générer la fiche'}</FxButton>
        </div>
      </div>
      <AttemptLog refreshKey={`${msg}|${busy}`} />

      <h2 className="h2">Brouillons <small>{drafts.length > 0 ? `${drafts.length} à relire` : ''}</small></h2>
      {drafts.length === 0 && <Empty title="Aucun brouillon">Les fiches générées arrivent ici, prêtes à être relues avant d’être validées.</Empty>}
      <ul className="rows">
        {drafts.map((d) => (
          <li key={d.id} className="rowcard">
            <div className="what">
              <b>{d.fiche?.meta.titre ?? d.id}</b>
              <small>{d.fiche ? <span className="chip" data-k="accent">À relire</span> : <span className="chip">Dernier essai incomplet</span>}</small>
            </div>
            <div className="acts">
              <button className="btn" onClick={() => onOpenDraft(d)}>Relire</button>
              <button onClick={() => downloadText(`${d.id}.json`, exportDraft(d))}>Exporter le JSON</button>
              <button onClick={async () => { await db?.deleteDraft(d.id); await refresh(); }}>Supprimer</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
