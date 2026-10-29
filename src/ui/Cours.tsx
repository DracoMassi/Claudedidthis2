import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useCallback, useEffect, useRef, useState } from 'react';
import { splitPdf, type Lot } from '../lib/cours/chunk';
import { checkMarkdown, type CoursMeta } from '../lib/cours/checks';
import { renderMarkdownPreview } from '../lib/cours/preview';
import { ImportQueue } from '../lib/cours/queue';
import { saveCours } from '../lib/cours/save';
import { transcribeLot, transcribeWithGemini } from '../lib/cours/transcribe';
import { ConflictError, RateLimitError } from '../lib/errors';
import { RequestBudget } from '../lib/gemini/budget';
import type { GithubRepo } from '../lib/github/repo';
import { slugify } from '../lib/slug';
import type { Db } from '../lib/storage/db';
import { getSettings } from '../lib/storage/settings';
import type { Problem } from '../lib/types';
import { messageFor } from './messages';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Meta = Omit<CoursMeta, 'statut'>;
type View = { id: string | null; meta: Meta; md: string };
type Row = { id: string; done: number; total: number; meta?: Meta };

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

  const queue = useCallback((t?: (l: Lot) => Promise<string>) => new ImportQueue(db as Db, t ?? (async () => '')), [db]);

  const refresh = useCallback(async () => {
    if (!db) return;
    const q = queue();
    const out: Row[] = [];
    for (const id of await q.ids()) out.push({ id, ...(await q.progress(id)), meta: (await db.get(`import-meta:${id}`)) as Meta | undefined });
    setRows(out);
    const s = getSettings();
    const u = new RequestBudget({ perMinute: s.maxPerMinute, perDay: s.maxPerDay }, undefined, 'sequentia.budget').used();
    setUsed(`${u.day}/${u.limit}`);
  }, [db, queue]);
  useEffect(() => { void refresh(); }, [refresh]);

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

  const run = async (id: string) => {
    const s = getSettings();
    if (!s.geminiKey) { setMsg('Ajoute ta clé Gemini dans Réglages'); return; }
    const budget = new RequestBudget({ perMinute: s.maxPerMinute, perDay: s.maxPerDay }, undefined, 'sequentia.budget');
    let last: unknown;
    setBusy(true); setMsg('');
    try {
      const q = queue(async (lot) => {
        if (!budget.canSend()) { last = new RateLimitError(budget.waitSeconds()); throw last; }
        budget.record();
        try { return await transcribeLot(lot, { llm: (l) => transcribeWithGemini({ key: s.geminiKey, model: s.model, lot: l }) }); }
        catch (e) { last = e; throw e; }
      });
      const r = await q.run(id);
      setMsg(r === 'done' ? 'Transcription terminée. Tu peux relire' : last ? `${messageFor(last)}. La progression est gardée` : 'En pause. La progression est gardée');
    } catch (e) { setMsg(messageFor(e)); } finally { setBusy(false); await refresh(); }
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

  const input = { style: { display: 'block', width: '100%', padding: 8 } };
  if (!db) return <div className="card">Chargement…</div>;

  if (view) {
    return (
      <div>
        <div className="card" style={{ marginBottom: 8 }}>
          <label>Matière <select {...input} value={view.meta.matiere} onChange={(e) => setView({ ...view, meta: { ...view.meta, matiere: e.target.value } })}>{['maths', 'physique', 'chimie', 'si', 'philosophie', 'histoire'].map((m) => <option key={m}>{m}</option>)}</select></label>
          <label>Chapitre <input {...input} value={view.meta.chapitre} onChange={(e) => setView({ ...view, meta: { ...view.meta, chapitre: e.target.value } })} /></label>
          <div style={{ marginTop: 8 }}>
            {problems.length === 0 ? 'Contrôles : tout est au vert' : <ul style={{ margin: 0 }}>{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>}
          </div>
        </div>
        <div className="review">
          <div className="pane card">
            <b>Page source</b>
            {total > 0 && <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédente</button><span>{page} / {total}</span><button disabled={page >= total} onClick={() => setPage(page + 1)}>Suivante</button></div>}
            {imgUrl ? <img src={imgUrl} alt={`Page ${page}`} style={{ maxWidth: '100%' }} /> : lotOf ? <canvas ref={canvas} style={{ maxWidth: '100%' }} /> : <p>Pas de page source (texte importé tel quel).</p>}
          </div>
          <div className="pane card">
            <b>Rendu</b>
            <div ref={preview} style={{ maxHeight: 420, overflow: 'auto' }} />
          </div>
        </div>
        <div className="card" style={{ marginTop: 8 }}>
          <textarea style={{ width: '100%', padding: 8 }} rows={12} value={view.md} onChange={(e) => setView({ ...view, md: e.target.value })} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button disabled={busy || !repo || !view.meta.chapitre.trim()} onClick={() => void save('a_verifier')}>Enregistrer (à vérifier)</button>
            <button className="btn" disabled={busy || !repo || !view.meta.chapitre.trim() || problems.some((p) => p.code === 'katex')} onClick={() => void save('verifie')}>Valider le cours (vérifié)</button>
            <button onClick={() => { setView(null); setLots([]); }}>Fermer</button>
            {conflict && <button onClick={() => void save(conflict, true)}>Écraser le cours existant</button>}
          </div>
          {!repo && <p>Ajoute ton jeton GitHub dans Réglages pour enregistrer.</p>}
          {msg && <p role="status">{msg}</p>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <label>Matière <select {...input} value={meta.matiere} onChange={(e) => setMeta({ ...meta, matiere: e.target.value })}>{['maths', 'physique', 'chimie', 'si', 'philosophie', 'histoire'].map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Niveau <select {...input} value={meta.niveau} onChange={(e) => setMeta({ ...meta, niveau: e.target.value })}><option>mpsi</option><option>terminale</option></select></label>
        <label>Chapitre <input {...input} value={meta.chapitre} onChange={(e) => setMeta({ ...meta, chapitre: e.target.value })} /></label>
        <label style={{ display: 'block', marginTop: 8 }}>Choisir dans Fichiers (PDF, images, .md, .tex, .txt) <input type="file" multiple accept="application/pdf,image/*,.md,.tex,.txt" onChange={(e) => void onFiles(e.target.files)} /></label>
        <label style={{ display: 'block', marginTop: 8 }}>Appareil photo <input type="file" accept="image/*" capture="environment" onChange={(e) => void onFiles(e.target.files)} /></label>
        <label style={{ display: 'block', marginTop: 8 }}>Ou coller du texte <textarea {...input} rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} /></label>
        <button disabled={!pasted.trim()} onClick={() => { setView({ id: null, meta: { ...meta, chapitre: meta.chapitre || 'Cours collé', source: 'texte collé' }, md: pasted }); setLots([]); }}>Utiliser ce texte</button>
        <p>Requêtes aujourd'hui : {used}</p>
      </div>
      {msg && <p role="status">{msg}</p>}
      <h2 className="titre" style={{ fontSize: 24 }}>Imports en cours</h2>
      {rows.length === 0 && <div className="card">Aucun import.</div>}
      {rows.map((r) => (
        <div key={r.id} className="card" style={{ marginBottom: 8 }}>
          <b>{r.meta?.chapitre ?? r.id}</b> · {r.meta?.source} · {r.done}/{r.total} lots
          <progress value={r.done} max={r.total} style={{ display: 'block', width: '100%' }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button className="btn" disabled={busy || r.done >= r.total} onClick={() => void run(r.id)}>{r.done === 0 ? 'Lancer' : 'Reprendre'}</button>
            <button disabled={r.done === 0} onClick={() => void openReview(r.id)}>Relire</button>
            <button onClick={async () => { await queue().remove(r.id); await refresh(); }}>Supprimer</button>
          </div>
        </div>
      ))}
    </div>
  );
}
