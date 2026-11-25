import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useCallback, useEffect, useRef, useState } from 'react';
import { splitPdf, type Lot } from '../lib/cours/chunk';
import { checkMarkdown, type CoursMeta } from '../lib/cours/checks';
import { renderMarkdownPreview } from '../lib/cours/preview';
import { ImportQueue, type LotInfo } from '../lib/cours/queue';
import { saveCours } from '../lib/cours/save';
import { verifyLot } from '../lib/cours/verify';
import { ConflictError } from '../lib/errors';
import { RequestBudget } from '../lib/gemini/budget';
import type { GithubRepo } from '../lib/github/repo';
import { slugify } from '../lib/slug';
import type { Db } from '../lib/storage/db';
import { getSettings } from '../lib/storage/settings';
import type { Problem } from '../lib/types';
import { TextArea, SelectField, TextField } from './Field';
import { FxButton } from './fx';
import { dismissJob } from '../lib/jobs/store';
import LiveProgress from './LiveProgress';
import { messageFor } from './messages';
import ModelSwitch from './ModelSwitch';
import { cancelAuto, rerunCoursLot, resumeNow, startCoursRun } from './runCours';
import { useJob } from './useJobs';
import { Empty, Notice, Quota, Section } from './kit';
import { AttemptLog, SegmentBar, StatusBadge, describeLot } from './status';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Meta = Omit<CoursMeta, 'statut'>;
type View = { id: string | null; meta: Meta; md: string };
type Row = { id: string; done: number; total: number; lots: LotInfo[]; meta?: Meta };

async function renderPdfPage(canvas: HTMLCanvasElement, data: Uint8Array, pageNumber: number): Promise<void> {
  const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.3 });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvas, canvasContext: canvas.getContext('2d') as CanvasRenderingContext2D, viewport }).promise;
}

export default function Cours({ repo, db }: { repo: GithubRepo | null; db: Db | null }) {
  const [meta, setMeta] = useState<Meta>({ matiere: 'maths', niveau: 'mpsi', chapitre: '', source: '' });
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState('');
  const [view, setView] = useState<View | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [page, setPage] = useState(1);
  const [conflict, setConflict] = useState<'a_verifier' | 'verifie' | null>(null);
  const [used, setUsed] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [imgUrl, setImgUrl] = useState('');
  // La transcription vit hors de ce composant : elle continue quand on change d'onglet, et son état est relu ici au retour.
  const job = useJob('cours');
  const jobBusy = job?.state === 'running';
  const runningId = jobBusy ? (job?.ref ?? null) : null;
  const finished = job && (job.state === 'done' || job.state === 'error') && !job.dismissed ? job : null;

  const queue = useCallback((t?: (l: Lot) => Promise<string>) => new ImportQueue(db as Db, t ?? (async () => ''), (lot, md) => verifyLot(lot, md)), [db]);

  const refresh = useCallback(async () => {
    if (!db) return;
    const q = queue();
    const out: Row[] = [];
    for (const id of await q.ids()) out.push({ id, ...(await q.progress(id)), lots: await q.lotInfos(id), meta: (await db.get(`import-meta:${id}`)) as Meta | undefined });
    setRows(out);
    const s = getSettings();
    const u = new RequestBudget({ perMinute: s.maxPerMinute, perDay: s.maxPerDay }, undefined, 'sequentia.budget').used();
    setUsed(`${u.day}/${u.limit}`);
  }, [db, queue]);
  // Les lots changent à chaque étape : on relit la liste quand la tâche avance ou change d'état (pas à chaque message).
  useEffect(() => { void refresh(); }, [refresh, job?.step, job?.state]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length || !db) return;
    const s = getSettings();
    setBusy(true); setMsg('');
    try {
      const arr = [...files];
      const q = queue();
      const images = arr.filter((f) => f.type.startsWith('image/'));
      for (const f of arr.filter((x) => x.type === 'application/pdf' || x.name.toLowerCase().endsWith('.pdf'))) {
        const buf = await f.arrayBuffer();
        const l = await splitPdf(buf, s.lotPages);
        const id = `${slugify(f.name.replace(/\.pdf$/i, ''))}-${Date.now().toString(36)}`;
        await q.enqueue(id, l);
        await db.put(`import-meta:${id}`, { ...meta, chapitre: meta.chapitre || f.name.replace(/\.pdf$/i, ''), source: `${f.name} (p. 1-${l[l.length - 1].toPage})` });
      }
      if (images.length) {
        const l: Lot[] = [];
        for (const [i, f] of images.entries()) l.push({ index: i, fromPage: i + 1, toPage: i + 1, data: new Uint8Array(await f.arrayBuffer()), mime: f.type });
        const id = `photos-${Date.now().toString(36)}`;
        await q.enqueue(id, l);
        await db.put(`import-meta:${id}`, { ...meta, chapitre: meta.chapitre || 'Photos de cours', source: `${images.length} photo${images.length > 1 ? 's' : ''}` });
      }
      for (const f of arr.filter((x) => /\.(md|tex|txt)$/i.test(x.name))) {
        // Enregistrés sans conversion : pas de transcription, relecture directe.
        setView({ id: null, meta: { ...meta, chapitre: meta.chapitre || f.name.replace(/\.[^.]+$/, ''), source: f.name }, md: await f.text() });
        setLots([]);
      }
      await refresh();
    } catch { setMsg("Impossible de lire ce fichier. Vérifie que c'est un PDF, une image ou un fichier texte"); } finally { setBusy(false); }
  };

  const run = async (id: string, title: string) => {
    if (!getSettings().geminiKey) { setMsg('Ajoute ta clé Gemini dans Réglages'); return; }
    if (!db) return;
    setMsg('');
    void startCoursRun(db, id, title);
  };

  const rerunLot = async (id: string, i: number, title: string) => {
    if (!getSettings().geminiKey) { setMsg('Ajoute ta clé Gemini dans Réglages'); return; }
    if (!db) return;
    setMsg('');
    void rerunCoursLot(db, id, i, title);
  };

  const openReview = async (id: string) => {
    if (!db) return;
    const q = queue();
    setView({ id, meta: ((await db.get(`import-meta:${id}`)) as Meta | undefined) ?? meta, md: await q.markdown(id) });
    setLots(await q.lots(id)); setPage(1); setConflict(null);
  };

  const total = lots.length ? lots[lots.length - 1].toPage : 0;
  const lotOf = lots.find((l) => page >= l.fromPage && page <= l.toPage);

  useEffect(() => {
    if (!view || !preview.current) return;
    const r = renderMarkdownPreview(preview.current, view.md);
    setProblems([...checkMarkdown(view.md).filter((p) => p.code !== 'katex'), ...r.katexErrors.map((message): Problem => ({ code: 'katex', message }))]);
  }, [view]);

  useEffect(() => {
    setImgUrl('');
    if (!lotOf) return;
    if (lotOf.mime?.startsWith('image/')) {
      const u = URL.createObjectURL(new Blob([lotOf.data.slice()], { type: lotOf.mime }));
      setImgUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    if (canvas.current) void renderPdfPage(canvas.current, lotOf.data, page - lotOf.fromPage + 1).catch(() => setMsg("Impossible d'afficher la page source"));
  }, [lotOf, page]);

  const save = async (statut: 'a_verifier' | 'verifie', force = false) => {
    if (!repo || !view) return;
    setBusy(true); setMsg('');
    try {
      const path = await saveCours(repo, { ...view.meta, statut }, view.md, { force });
      if (view.id && db) { await queue().remove(view.id); await refresh(); }
      setConflict(null);
      setMsg(`Cours enregistré : ${path} (${statut === 'verifie' ? 'vérifié' : 'à vérifier'})`);
    } catch (e) {
      if (e instanceof ConflictError) setConflict(statut);
      setMsg(e instanceof ConflictError ? 'Ce cours existe déjà. Écraser ou annuler' : messageFor(e, { source: 'github', offline: !navigator.onLine }));
    } finally { setBusy(false); }
  };

  const MATIERES = ['maths', 'physique', 'chimie', 'si', 'philosophie', 'histoire'];
  if (!db) return <div className="card muted">Chargement…</div>;

  if (view) {
    return (
      <div>
        <div className="card">
          <div className="grid2">
          <SelectField label="Matière" value={view.meta.matiere} onChange={(e) => setView({ ...view, meta: { ...view.meta, matiere: e.target.value } })}>{MATIERES.map((m) => <option key={m}>{m}</option>)}</SelectField>
          <TextField label="Chapitre" value={view.meta.chapitre} onChange={(e) => setView({ ...view, meta: { ...view.meta, chapitre: e.target.value } })} />
          </div>
          {problems.length === 0 ? <Notice kind="ok">Tous les contrôles sont au vert.</Notice> : <Notice kind="error"><ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul></Notice>}
        </div>
        <div className="review">
          <div className="pane card">
            <h3 className="page-title" style={{ marginTop: 0 }}>Page source</h3>
            {total > 0 && <div className="toolbar"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédente</button><span className="muted" aria-live="polite">Page {page} sur {total}</span><button disabled={page >= total} onClick={() => setPage(page + 1)}>Suivante</button></div>}
            {imgUrl ? <img src={imgUrl} alt={`Page ${page}`} style={{ maxWidth: '100%' }} /> : lotOf ? <canvas ref={canvas} style={{ maxWidth: '100%' }} /> : <p>Pas de page source (texte importé tel quel).</p>}
          </div>
          <div className="pane card">
            <h3 className="page-title" style={{ marginTop: 0 }}>Rendu</h3>
            <div ref={preview} style={{ maxHeight: 420, overflow: 'auto' }} />
          </div>
        </div>
        <div className="card">
          <TextArea label="Texte du cours (Markdown)" rows={12} value={view.md} onChange={(e) => setView({ ...view, md: e.target.value })} />
          <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
            <FxButton fx="shine" className="btn" disabled={busy || !repo || !view.meta.chapitre.trim() || problems.some((p) => p.code === 'katex')} onClick={() => void save('verifie')}>Valider le cours</FxButton>
            <button className="btn ghost" disabled={busy || !repo || !view.meta.chapitre.trim()} onClick={() => void save('a_verifier')}>Enregistrer sans valider</button>
            <span className="sp" />
            {conflict && <button onClick={() => void save(conflict, true)}>Écraser le cours existant</button>}
            <button onClick={() => { setView(null); setLots([]); }}>Fermer</button>
          </div>
          {!repo && <Notice>Ajoute ton jeton GitHub dans Réglages pour enregistrer.</Notice>}
          {msg && <Notice kind={msg.startsWith('Cours enregistré') || msg.includes('enregistré') ? 'ok' : 'info'}>{msg}</Notice>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <Section title="Quel cours ?">
          <div className="grid3">
            <SelectField label="Matière" value={meta.matiere} onChange={(e) => setMeta({ ...meta, matiere: e.target.value })}>{MATIERES.map((m) => <option key={m}>{m}</option>)}</SelectField>
            <SelectField label="Niveau" value={meta.niveau} onChange={(e) => setMeta({ ...meta, niveau: e.target.value })}><option>mpsi</option><option>terminale</option></SelectField>
            <TextField label="Chapitre" value={meta.chapitre} onChange={(e) => setMeta({ ...meta, chapitre: e.target.value })} />
          </div>
        </Section>
        <Section title="D’où vient-il ?" hint="PDF, photos ou fichiers texte sont découpés en lots, transcrits puis contrôlés.">
          <div className="drop-row">
            <label className="drop">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
              <div><b>Choisir dans Fichiers</b><span>PDF, images, .md, .tex, .txt</span></div>
              <input type="file" multiple accept="application/pdf,image/*,.md,.tex,.txt" onChange={(e) => void onFiles(e.target.files)} />
            </label>
            <label className="drop">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
              <div><b>Prendre une photo</b><span>Appareil photo de l’iPad</span></div>
              <input type="file" accept="image/*" capture="environment" onChange={(e) => void onFiles(e.target.files)} />
            </label>
          </div>
          <TextArea label="Ou coller du texte" rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <button className="btn" disabled={!pasted.trim()} onClick={() => { setView({ id: null, meta: { ...meta, chapitre: meta.chapitre || 'Cours collé', source: 'texte collé' }, md: pasted }); setLots([]); }}>Utiliser ce texte</button>
            <span className="sp" />
            <ModelSwitch compact />
            <Quota used={used} />
          </div>
        </Section>
      </div>
      {msg && <Notice kind={/impossible|refus|échec|erreur/i.test(msg) ? 'error' : 'info'}>{msg}</Notice>}
      {!msg && finished && (
        <Notice kind={finished.outcome === 'ok' ? 'ok' : 'error'} action={<button onClick={() => dismissJob('cours')}>Fermer</button>}>{finished.message}</Notice>
      )}
      <h2 className="h2">Imports en cours <small>{rows.length > 0 ? `${rows.length}` : ''}</small></h2>
      {rows.length === 0 && <Empty title="Aucun import">Dépose un PDF ou des photos ci-dessus : la progression de chaque lot s’affichera ici.</Empty>}
      {job && (job.state === 'running' || job.state === 'waiting') && (
        <div className="card"><LiveProgress job={job} onResume={resumeNow} onCancel={cancelAuto} /></div>
      )}
      <ul className="rows">
      {rows.map((r) => {
        const bad = r.lots.filter((l) => l.state === 'suspect' || l.state === 'failed').length;
        const ok = r.lots.filter((l) => l.state === 'ok').length;
        const stateOf = (l: LotInfo, i: number) => (runningId === r.id && i === r.done && l.state === 'pending' ? 'running' as const : l.state);
        return (
          <li key={r.id} className="card" style={{ marginBottom: 0 }}>
            <div className="rowcard" style={{ padding: 0, background: 'transparent', border: 0 }}>
              <div className="what">
                <b>{r.meta?.chapitre ?? r.id}</b>
                <small>{r.meta?.source} · {r.done} sur {r.total} lots</small>
              </div>
              <div className="acts">
                <button className="btn" disabled={busy || jobBusy || r.done >= r.total} onClick={() => void run(r.id, r.meta?.chapitre ?? r.id)}>{r.done === 0 ? 'Lancer' : 'Reprendre'}</button>
                <button disabled={r.done === 0} onClick={() => void openReview(r.id)}>Relire</button>
                <button onClick={async () => { await queue().remove(r.id); await refresh(); }}>Supprimer</button>
              </div>
            </div>
            <SegmentBar label={`${r.done} lots traités sur ${r.total}, ${bad} à contrôler`} segments={r.lots.map((l, i) => ({ state: stateOf(l, i), title: `Lot ${i + 1}` }))} />
            <details className="adv" style={{ marginTop: 8, paddingTop: 8 }} open={bad > 0}>
              <summary>{ok} lot{ok > 1 ? 's' : ''} vérifié{ok > 1 ? 's' : ''}{bad > 0 ? `, ${bad} à contrôler` : ''}</summary>
              <ul className="lots">
                {r.lots.map((l, i) => (
                  <li key={i}>
                    <StatusBadge state={stateOf(l, i)} />
                    <span>Lot {i + 1} (p. {l.fromPage}-{l.toPage})</span>
                    <span className="note">{describeLot(l)}</span>
                    {(l.state === 'suspect' || l.state === 'failed') && <button className="btn ghost" style={{ minHeight: 36, padding: '0 16px', fontSize: 14 }} disabled={busy || jobBusy} onClick={() => void rerunLot(r.id, i, r.meta?.chapitre ?? r.id)}>Relancer ce lot</button>}
                  </li>
                ))}
              </ul>
            </details>
          </li>
        );
      })}
      </ul>
      <AttemptLog refreshKey={`${msg}|${rows.length}|${job?.state}|${job?.step}`} />
    </div>
  );
}
