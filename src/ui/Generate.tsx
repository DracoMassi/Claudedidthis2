import { useCallback, useEffect, useRef, useState } from 'react';
import { RequestBudget } from '../lib/gemini/budget';
import { blockLabel, countBlocks, mergeRef, refFromJson, removeBlock, removeRef, type RefMode, type RefSet } from '../lib/generate/refs';
import type { GithubRepo } from '../lib/github/repo';
import { AuthError } from '../lib/errors';
import { dismissJob, isRunning } from '../lib/jobs/store';
import { slugify } from '../lib/slug';
import { exportDraft, type Db, type Draft } from '../lib/storage/db';
import { getSettings } from '../lib/storage/settings';
import type { Brief } from '../lib/types';
import { AttemptLog } from './status';
import { TextArea, SelectField, TextField } from './Field';
import { FxButton } from './fx';
import LiveProgress from './LiveProgress';
import { messageFor } from './messages';
import ModelSwitch from './ModelSwitch';
import { runGenerate } from './runGenerate';
import { useJob } from './useJobs';
import { Empty, Notice, Quota, Section } from './kit';

type Props = {
  repo: GithubRepo | null; db: Db | null; initialBrief?: Brief | null; onOpenDraft: (d: Draft) => void;
  /** Blocs de la bibliothèque mis de côté pour cette génération (gérés par l'App : la Bibliothèque peut en ajouter). */
  refs: RefSet; onRefsChange: (r: RefSet) => void; onGoLibrary: () => void;
};

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

export default function Generate({ repo, db, initialBrief, onOpenDraft, refs, onRefsChange, onGoLibrary }: Props) {
  const [f, setF] = useState<Form>(EMPTY);
  const [msg, setMsg] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [used, setUsed] = useState('');
  const [pasteJson, setPasteJson] = useState('');
  const refsEl = useRef<HTMLDivElement>(null);
  const prevCount = useRef(countBlocks(refs));

  // La génération vit hors de ce composant : changer d'onglet ne l'interrompt pas, et son état est relu ici au retour.
  const job = useJob('generate');
  const busy = job?.state === 'running';
  const finished = job && (job.state === 'done' || job.state === 'error') && !job.dismissed ? job : null;
  const problems = finished?.problems ?? [];

  const refresh = useCallback(async () => {
    if (db) setDrafts(await db.listDrafts());
    const s = getSettings();
    const u = new RequestBudget({ perMinute: s.maxPerMinute, perDay: s.maxPerDay }, undefined, 'sequentia.budget').used();
    setUsed(`${u.day}/${u.limit}`);
  }, [db]);
  useEffect(() => { void refresh(); }, [refresh, job?.state]);
  useEffect(() => { if (initialBrief) setF(fromBrief(initialBrief)); }, [initialBrief]);
  useEffect(() => {
    const n = countBlocks(refs);
    if (n > prevCount.current) refsEl.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    prevCount.current = n;
  }, [refs]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  /** Un fichier .json : un brief remplit le formulaire ; une fiche ou une liste de blocs devient une référence. */
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    let text = '';
    try { text = await file.text(); JSON.parse(text); } catch { setMsg("Ce fichier n'est pas un JSON valide"); return; }
    const data = JSON.parse(text) as unknown;
    if (Array.isArray(data) || (typeof data === 'object' && data !== null && 'pages' in data)) {
      try {
        const ref = refFromJson(text, file.name.replace(/\.json$/i, ''));
        onRefsChange(mergeRef(refs, ref));
        setMsg(`${ref.blocks.length} bloc${ref.blocks.length > 1 ? 's' : ''} ajouté${ref.blocks.length > 1 ? 's' : ''} aux références`);
      } catch (e) { setMsg((e as Error).message); }
      return;
    }
    setF(fromBrief(data as Brief)); setMsg('');
  };

  const addPasted = () => {
    try {
      const ref = refFromJson(pasteJson);
      onRefsChange(mergeRef(refs, ref));
      setPasteJson('');
      setMsg(`${ref.blocks.length} bloc${ref.blocks.length > 1 ? 's' : ''} ajouté${ref.blocks.length > 1 ? 's' : ''} aux références`);
    } catch (e) { setMsg((e as Error).message); }
  };

  const run = async () => {
    const s = getSettings();
    if (!s.geminiKey) { setMsg(messageFor(new AuthError())); return; }
    if (!repo || !db) { setMsg('Ajoute ton jeton GitHub, le propriétaire et le nom du dépôt dans Réglages'); return; }
    if (!f.sujet.trim() || !f.chapitre.trim()) { setMsg('Renseigne au moins le chapitre et le sujet'); return; }
    if (isRunning('generate')) { setMsg('Une génération est déjà en cours'); return; }
    setMsg('');
    void runGenerate({ repo, db, brief: toBrief(f), refs });
  };

  const MATIERES = ['maths', 'physique', 'chimie', 'si', 'philosophie', 'histoire'];
  const pret = f.sujet.trim() && f.chapitre.trim();
  const nRefs = countBlocks(refs);
  const notice = msg || finished?.message || '';
  const noticeKind = msg ? (/aux références/.test(msg) ? 'ok' as const : 'info' as const) : finished?.outcome === 'ok' ? 'ok' as const : 'error' as const;

  return (
    <div>
      <div className="card">
        <label className="drop">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
          <div><b>Reprendre un brief ou une fiche</b><span>Un brief .json remplit le formulaire ; une fiche ou des blocs deviennent des références</span></div>
          <input type="file" accept="application/json,.json" onChange={(e) => { void importJson(e.target.files?.[0]); e.target.value = ''; }} />
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

        <div ref={refsEl}>
          <Section title="Références de la bibliothèque" hint="Des blocs de fiches existantes que Gemini doit reprendre ou imiter. Choisis-les dans la Bibliothèque, dépose un .json ou colle du JSON.">
            {refs.items.length === 0 && <p className="muted" style={{ margin: '0 0 12px' }}>Aucune référence pour l’instant.</p>}
            {refs.items.length > 0 && (
              <ul className="rows" style={{ marginBottom: 12 }}>
                {refs.items.map((r) => (
                  <li key={r.id} className="rowcard">
                    <div className="what"><b>{r.titre}</b><small>{r.blocks.length} bloc{r.blocks.length > 1 ? 's' : ''}{r.matiere ? ` · ${r.matiere}` : ''}</small></div>
                    <div className="acts"><button onClick={() => onRefsChange(removeRef(refs, r.id))}>Retirer</button></div>
                    <details className="adv" style={{ flexBasis: '100%', marginTop: 0, paddingTop: 8 }}>
                      <summary>Voir les blocs</summary>
                      <ul className="lots">
                        {r.blocks.map((b) => (
                          <li key={`${b.page}.${b.index}`}>
                            <span>{blockLabel(b.block)}</span>
                            <span className="note">page {b.page + 1}</span>
                            <button className="btn ghost" style={{ minHeight: 32, padding: '0 14px', fontSize: 14 }} aria-label={`Retirer ${blockLabel(b.block)}`} onClick={() => onRefsChange(removeBlock(refs, r.id, b.page, b.index))}>Retirer</button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            {nRefs > 0 && (
              <SelectField label="Comment les utiliser ?" value={refs.mode} onChange={(e) => onRefsChange({ ...refs, mode: e.target.value as RefMode })}>
                <option value="inspire">S’en inspirer (structure et style)</option>
                <option value="reprendre">Les reprendre dans la fiche</option>
              </SelectField>
            )}
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <button className="btn ghost" onClick={onGoLibrary}>Choisir dans la bibliothèque</button>
              {nRefs > 0 && <button onClick={() => onRefsChange({ ...refs, items: [] })}>Tout retirer</button>}
            </div>
            <details className="adv">
              <summary>Coller du JSON (fiche, bloc ou liste de blocs)</summary>
              <TextArea label="JSON" rows={4} value={pasteJson} onChange={(e) => setPasteJson(e.target.value)} />
              <button className="btn" disabled={!pasteJson.trim()} onClick={addPasted}>Ajouter aux références</button>
            </details>
          </Section>
        </div>

        <details className="adv" open={!!(f.exclure || f.consignes)}>
          <summary>Options avancées</summary>
          <TextArea label="À exclure" rows={2} hint="Notions à ne pas aborder, une par ligne." value={f.exclure} onChange={(e) => set('exclure', e.target.value)} />
          <TextArea label="Consignes de style" rows={2} value={f.consignes} onChange={(e) => set('consignes', e.target.value)} />
        </details>
      </div>

      {notice && !busy && (
        <Notice kind={noticeKind} action={!msg && finished ? <button onClick={() => dismissJob('generate')}>Fermer</button> : undefined}>{notice}</Notice>
      )}
      {problems.length > 0 && !busy && (
        <details className="adv" style={{ marginTop: -8, marginBottom: 20 }}>
          <summary>{problems.length} point{problems.length > 1 ? 's' : ''} à corriger dans la fiche</summary>
          <ul>{problems.map((p, i) => <li key={i}>{p.code}{p.path ? ` ${p.path}` : ''} : {p.message}</li>)}</ul>
        </details>
      )}

      <div className="modelrow"><ModelSwitch compact /></div>
      <div className="actionbar">
        <div className="grow">
          {busy && job ? <LiveProgress job={job} /> : pret ? <Quota used={used} /> : <span>Renseigne le chapitre et le sujet pour lancer la génération.</span>}
        </div>
        <div className="btns">
          <FxButton fx="magnetic" className="btn btn-lg" disabled={busy || !pret} onClick={() => void run()}>{busy ? 'Génération en cours…' : 'Générer la fiche'}</FxButton>
        </div>
      </div>
      <AttemptLog refreshKey={`${notice}|${job?.state}|${job?.step}`} />

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
