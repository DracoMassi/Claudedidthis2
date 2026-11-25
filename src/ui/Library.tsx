import { useEffect, useMemo, useRef, useState } from 'react';
import AsyncButton from './AsyncButton';
import { SelectField, TextField } from './Field';
import { printPages } from '../lib/export/pdf';
import { exportPng, isLikelyBlank } from '../lib/export/png';
import { exportVerifiedPdf, type PdfReport } from '../lib/export/pdfBuild';
import { StatusBadge } from './status';
import BlockPicker from './BlockPicker';
import PaletteQuick from './PaletteQuick';
import { useFichePalette } from './useFichePalette';
import { refFromFiche, type Ref } from '../lib/generate/refs';
import { Empty, Notice } from './kit';
import { libraryMessage } from '../lib/github/diagnose';
import type { GithubRepo } from '../lib/github/repo';
import { filterItems, loadIndex, setExemple, type LibraryItem } from '../lib/library/index';
import { renderFiche } from '../lib/render/renderFiche';
import { validateFiche } from '../lib/schema/validate';
import type { Db } from '../lib/storage/db';
import type { Brief, Fiche } from '../lib/types';

type Props = {
  repo: GithubRepo | null; db: Db | null; onEdit?: (path: string) => void; onRedo?: (brief: Brief) => void;
  /** Envoie des blocs de la fiche ouverte vers Générer (références de génération). */
  onSendRefs?: (ref: Ref) => void;
};

export default function Library({ repo, db, onEdit, onRedo, onSendRefs }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [msg, setMsg] = useState('');
  const [matiere, setMatiere] = useState('');
  const [text, setText] = useState('');
  const [sel, setSel] = useState<LibraryItem | null>(null);
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [cours, setCours] = useState('');
  const preview = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!repo || !db) return;
    loadIndex(repo, db).then(setItems, (e) => setMsg(libraryMessage(e)));
  }, [repo, db]);

  const shown = useMemo(() => filterItems(items, { matiere: matiere || undefined, text }), [items, matiere, text]);
  const matieres = useMemo(() => [...new Set(items.map((i) => i.matiere))], [items]);

  const open = async (item: LibraryItem) => {
    if (!repo) return;
    setSel(item); setFiche(null); setCours(''); setMsg('');
    try {
      const { content } = await repo.readFile(item.path);
      if (item.kind === 'cours') { setCours(content); return; }
      const data = JSON.parse(content) as unknown;
      if (validateFiche(data).length) { setMsg('Cette fiche ne respecte plus le schéma. Ouvre-la dans Relire'); return; }
      setFiche(data as Fiche);
    } catch { setMsg("Impossible d'ouvrir ce fichier. Réessayer"); }
  };

  const palette = useFichePalette();
  useEffect(() => { if (fiche && preview.current) renderFiche(preview.current, fiche, palette); }, [fiche, palette]);

  const [report, setReport] = useState<PdfReport | null>(null);

  const exporterPdf = async (): Promise<boolean> => {
    if (!sel || !fiche) return false;
    setReport(null); setMsg('');
    const pages = [...(preview.current?.querySelectorAll<HTMLElement>('.fiche-page') ?? [])];
    try {
      const { bytes, report: rep } = await exportVerifiedPdf(pages, fiche.meta.format ?? 'fiche');
      setReport(rep);
      if (!bytes) return false;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
      a.download = `${sel.slug}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      return true;
    } catch { setMsg("La fabrication du PDF a échoué. Utilise l'impression ou l'export PNG"); return false; }
  };

  const exporterPng = async (): Promise<boolean> => {
    if (!sel) return false;
    const pages = [...(preview.current?.querySelectorAll<HTMLElement>('.fiche-page') ?? [])];
    try {
      const blobs = await exportPng(pages);
      if (blobs.some(isLikelyBlank)) { setMsg("L'image semble vide. Utilise l'export PDF"); return false; }
      blobs.forEach((b, n) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `${sel.slug}-${n + 1}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      });
      return true;
    } catch { setMsg("L'export PNG a échoué. Utilise l'export PDF"); return false; }
  };

  if (!repo) return <Empty title="Bibliothèque non connectée">Ajoute ton jeton GitHub, le propriétaire et le nom du dépôt dans Réglages.</Empty>;

  return (
    <div>
      <div className="card search">
        <TextField label="Rechercher une fiche ou un cours" value={text} onChange={(e) => setText(e.target.value)} fieldStyle={{ margin: 0 }} />
        <SelectField label="Matière" value={matiere} onChange={(e) => setMatiere(e.target.value)} fieldStyle={{ margin: 0, maxWidth: 280 }}>
          <option value="">Toutes les matières</option>
          {matieres.map((m) => <option key={m}>{m}</option>)}
        </SelectField>
      </div>
      {msg && <Notice kind="error">{msg}</Notice>}
      {shown.length === 0
        ? <Empty title={items.length === 0 ? 'Rien dans la bibliothèque pour l’instant' : 'Aucun résultat'}>{items.length === 0 ? 'Valide une fiche ou enregistre un cours : il apparaîtra ici.' : 'Essaie un autre mot, ou choisis « Toutes les matières ».'}</Empty>
        : (
          <ul className="libgrid">
            {shown.map((i) => (
              <li key={i.path}>
                <button className="libcard" aria-pressed={sel?.path === i.path} onClick={() => open(i)}>
                  <b>{i.slug}</b>
                  <span className="meta">
                    <span className="chip">{i.matiere}</span>
                    <span className="chip">{i.kind === 'cours' ? 'Cours' : 'Fiche'}</span>
                    {i.statut === 'verifie' && <span className="chip" data-k="ok">Validée</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      {sel && (
        <div className="card screen" key={sel.path}>
          <div className="h2" style={{ margin: '0 0 12px' }}>{sel.slug}</div>
          <div className="toolbar">
            {fiche && <AsyncButton fx="spotlight" className="btn" successLabel="PDF vérifié" run={exporterPdf}>Exporter en PDF</AsyncButton>}
            {fiche && <AsyncButton className="btn ghost" successLabel="Exporté" run={exporterPng}>Exporter en PNG</AsyncButton>}
            {fiche && <button className="btn ghost" onClick={() => printPages(fiche.meta.format ?? 'fiche', () => setMsg("La boîte d'impression s'est fermée. Vérifie que le fichier est bien dans Fichiers"))}>Imprimer</button>}
            <span className="sp" />
            {onEdit && sel.kind === 'fiche' && <button className="btn ghost" onClick={() => onEdit(sel.path)}>Modifier</button>}
            {fiche && onSendRefs && <button className="btn ghost" onClick={() => onSendRefs(refFromFiche(fiche, sel.path))}>Envoyer vers Générer</button>}
            {fiche && <button className="btn ghost" disabled={!fiche.meta.brief || !onRedo} onClick={() => fiche.meta.brief && onRedo?.(fiche.meta.brief)}>Refaire à partir du brief</button>}
            {fiche && (
              <button className="btn ghost" onClick={async () => {
                try { await setExemple(repo, sel.path, !fiche.meta.exemple); setFiche({ ...fiche, meta: { ...fiche.meta, exemple: !fiche.meta.exemple } }); }
                catch { setMsg("Impossible d'enregistrer. Réessayer"); }
              }}>{fiche.meta.exemple ? 'Retirer des exemples de style' : 'Utiliser comme exemple de style'}</button>
            )}
          </div>
          {report && (
            <div className="report" role="status">
              <StatusBadge state={report.ok ? 'ok' : 'failed'}>{report.ok ? `PDF créé · ${report.pages} page${report.pages > 1 ? 's' : ''} · ${Math.round(report.bytes / 1024)} Ko · aucune page vide` : 'PDF non créé'}</StatusBadge>
              {report.problems.map((p, i) => <span key={i}>{p}</span>)}
            </div>
          )}
          {fiche && <PaletteQuick />}
          {fiche && onSendRefs && <BlockPicker fiche={fiche} path={sel.path} onSend={onSendRefs} />}
          {!fiche && !cours && !msg && <p className="muted">Ouverture…</p>}
          {fiche && <div className="print-area export-root previewbox" ref={preview} />}
          {cours && <pre className="cours-text">{cours}</pre>}
        </div>
      )}
    </div>
  );
}
