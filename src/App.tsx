import { useState } from 'react';
import Settings from './ui/Settings';

export const ENTREES = ['Générer', 'Relire', 'Bibliothèque', 'Cours', 'Réglages'] as const;
export type Entree = (typeof ENTREES)[number];

export default function App() {
  const [entree, setEntree] = useState<Entree>('Générer');
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
      {entree === 'Réglages' ? <Settings /> : <div className="card">Écran « {entree} » : à venir.</div>}
    </div>
  );
}
