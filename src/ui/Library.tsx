import { useEffect, useMemo, useRef, useState } from 'react';
import { printPages } from '../lib/export/pdf';
import { exportPng, isLikelyBlank } from '../lib/export/png';
import type { GithubRepo } from '../lib/github/repo';
import { filterItems, loadIndex, setExemple, type LibraryItem } from '../lib/library/index';
import { renderFiche } from '../lib/render/renderFiche';
import { validateFiche } from '../lib/schema/validate';
import type { Db } from '../lib/storage/db';
import type { Brief, Fiche } from '../lib/types';

type Props = { repo: GithubRepo | null; db: Db | null; onEdit?: (path: string) => void; onRedo?: (brief: Brief) => void };

export default function Library({ repo, db, onEdit, onRedo }: Props) {
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
    loadIndex(repo, db).then(setItems, () => setMsg('Impossible de charger la bibliothèque. Vérifie ton jeton dans Réglages'));
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

  useEffect(() => { if (fiche && preview.current) renderFiche(preview.current, fiche); }, [fiche]);

  if (!repo) return <div className="card">Ajoute ton jeton GitHub, le propriétaire et le nom du dépôt dans Réglages.</div>;

  return (
    <div>
      <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="Rechercher" value={text} onChange={(e) => setText(e.target.value)} style={{ padding: 8 }} />
        <select value={matiere} onChange={(e) => setMatiere(e.target.value)} style={{ padding: 8 }}>
          <option value="">Toutes les matières</option>
          {matieres.map((m) => <option key={m}>{m}</option>)}
        </select>
      </div>
      {msg && <p role="alert">{msg}</p>}
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {shown.map((i) => (
          <li key={i.path} className="card lift">
            <button onClick={() => open(i)} style={{ all: 'unset', cursor: 'pointer', display: 'block' }}>
              <b>{i.slug}</b> · {i.matiere} · {i.kind === 'cours' ? 'cours' : 'fiche'}
              {i.statut === 'verifie' && <span className="badge ok"> validée</span>}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="card">Aucun élément.</li>}
      </ul>
      {sel && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {fiche && <button className="btn" onClick={() => printPages(fiche.meta.format ?? 'fiche')}>Exporter en PDF</button>}
            {fiche && (
              <button className="btn ghost" onClick={async () => {
                const pages = [...(preview.current?.querySelectorAll<HTMLElement>('.fiche-page') ?? [])];
                try {
                  const blobs = await exportPng(pages);
                  if (blobs.some(isLikelyBlank)) { setMsg("L'image semble vide. Utilise l'export PDF"); return; }
                  blobs.forEach((b, n) => {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(b);
                    a.download = `${sel.slug}-${n + 1}.png`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
                  });
                } catch { setMsg("L'export PNG a échoué. Utilise l'export PDF"); }
              }}>Exporter en PNG</button>
            )}
            {onEdit && sel.kind === 'fiche' && <button className="btn ghost" onClick={() => onEdit(sel.path)}>Modifier</button>}
            {fiche && <button className="btn ghost" disabled={!fiche.meta.brief || !onRedo} onClick={() => fiche.meta.brief && onRedo?.(fiche.meta.brief)}>Refaire à partir de ce brief</button>}
            {fiche && (
              <button className="btn ghost" onClick={async () => {
                try { await setExemple(repo, sel.path, !fiche.meta.exemple); setFiche({ ...fiche, meta: { ...fiche.meta, exemple: !fiche.meta.exemple } }); }
                catch { setMsg("Impossible d'enregistrer. Réessayer"); }
              }}>{fiche.meta.exemple ? 'Retirer des exemples' : 'Marquer comme exemple de style'}</button>
            )}
          </div>
          {fiche && <div className="print-area export-root" ref={preview} style={{ overflow: 'auto', maxWidth: '100%' }} />}
          {cours && <pre style={{ whiteSpace: 'pre-wrap' }}>{cours}</pre>}
        </div>
      )}
    </div>
  );
}
