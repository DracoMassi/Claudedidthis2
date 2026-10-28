import { useState } from 'react';
import Generate from './ui/Generate';
import Library from './ui/Library';
import Review from './ui/Review';
import type { Brief } from './lib/types';
import type { Draft } from './lib/storage/db';
import Settings from './ui/Settings';
import { useDb, useRepo } from './ui/hooks';

export const ENTREES = ['Générer', 'Relire', 'Bibliothèque', 'Cours', 'Réglages'] as const;
export type Entree = (typeof ENTREES)[number];

export default function App() {
  const [entree, setEntree] = useState<Entree>('Générer');
  const repo = useRepo();
  const db = useDb();
  const [redo, setRedo] = useState<Brief | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editPath, setEditPath] = useState<string | null>(null);
  const quadrille = entree !== 'Relire';
  return (
    <div className={`app${quadrille ? ' grid-bg' : ''}`}>
      <div className="logo">sequentia</div>
      <nav className="nav" aria-label="Navigation">
        {ENTREES.map((e) => (
          <button key={e} aria-current={e === entree ? 'page' : undefined} onClick={() => setEntree(e)}>
            {e}
          </button>
        ))}
      </nav>
      <h1 className="titre">{entree}</h1>
      {entree === 'Réglages' ? <Settings /> : entree === 'Relire' ? <Review repo={repo} db={db} draft={draft} path={editPath} /> : entree === 'Générer' ? <Generate repo={repo} db={db} initialBrief={redo} onOpenDraft={(d) => { setDraft(d); setEditPath(null); setEntree('Relire'); }} /> : entree === 'Bibliothèque' ? <Library repo={repo} db={db} onEdit={(p) => { setEditPath(p); setDraft(null); setEntree('Relire'); }} onRedo={(b) => { setRedo(b); setEntree('Générer'); }} /> : <div className="card">Écran « {entree} » : à venir.</div>}
    </div>
  );
}
