import { useState } from 'react';
import Library from './ui/Library';
import Settings from './ui/Settings';
import { useDb, useRepo } from './ui/hooks';

export const ENTREES = ['Générer', 'Relire', 'Bibliothèque', 'Cours', 'Réglages'] as const;
export type Entree = (typeof ENTREES)[number];

export default function App() {
  const [entree, setEntree] = useState<Entree>('Générer');
  const repo = useRepo();
  const db = useDb();
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
      {entree === 'Réglages' ? <Settings /> : entree === 'Bibliothèque' ? <Library repo={repo} db={db} /> : <div className="card">Écran « {entree} » : à venir.</div>}
    </div>
  );
}
