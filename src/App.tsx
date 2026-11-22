import { useEffect, useState } from 'react';
import Cours from './ui/Cours';
import Generate from './ui/Generate';
import Library from './ui/Library';
import Review from './ui/Review';
import type { Brief } from './lib/types';
import type { Draft } from './lib/storage/db';
import Settings from './ui/Settings';
import { useDb, useRepo } from './ui/hooks';
import { Notice, PageHead } from './ui/kit';
import { getSettings } from './lib/storage/settings';

export const ENTREES = ['Générer', 'Relire', 'Bibliothèque', 'Cours', 'Réglages'] as const;
export type Entree = (typeof ENTREES)[number];

const LEAD: Record<Entree, string> = {
  Générer: 'Décris le sujet, Gemini écrit la fiche et la contrôle jusqu’à 4 fois avant de te la rendre.',
  Relire: 'Corrige les blocs, coche la checklist, puis valide : la fiche est enregistrée dans ton dépôt.',
  Bibliothèque: 'Retrouve tes fiches et tes cours, puis exporte-les en PDF ou en image.',
  Cours: 'Transforme un PDF, des photos ou du texte en cours Markdown, vérifié page par page.',
  Réglages: 'Connecte ton dépôt GitHub et Gemini, puis règle l’apparence.',
};

export default function App() {
  const [entree, setEntree] = useState<Entree>('Générer');
  const repo = useRepo();
  const db = useDb();
  const [redo, setRedo] = useState<Brief | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editPath, setEditPath] = useState<string | null>(null);
  const [nbDrafts, setNbDrafts] = useState(0);
  const [, setTick] = useState(0);
  const quadrille = entree !== 'Relire';

  useEffect(() => { if (db) void db.listDrafts().then((l) => setNbDrafts(l.length)); }, [db, entree]);
  useEffect(() => {
    const f = () => setTick((n) => n + 1);
    window.addEventListener('sequentia-settings-changed', f);
    return () => window.removeEventListener('sequentia-settings-changed', f);
  }, []);
  useEffect(() => { window.scrollTo({ top: 0 }); document.title = `${entree} · Séquentia`; }, [entree]);

  const s = getSettings();
  const manque = !repo ? 'ton jeton GitHub et ton dépôt' : !s.geminiKey ? 'ta clé Gemini' : '';

  return (
    <div className={`app${quadrille ? ' grid-bg' : ''}`}>
      <div className="topbar"><div className="logo">sequentia</div></div>
      <nav className="nav" aria-label="Navigation">
        {ENTREES.map((e) => (
          <button key={e} aria-current={e === entree ? 'page' : undefined} onClick={() => setEntree(e)}>
            {e}
            {e === 'Générer' && nbDrafts > 0 && <span className="dot" aria-label={`${nbDrafts} brouillon${nbDrafts > 1 ? 's' : ''}`}>{nbDrafts}</span>}
          </button>
        ))}
      </nav>
      <main className="screen" key={entree}>
        <PageHead title={entree} lead={LEAD[entree]} />
        {manque && entree !== 'Réglages' && (
          <Notice action={<button className="btn" onClick={() => setEntree('Réglages')}>Ouvrir les réglages</button>}>
            Il manque {manque} pour que l’app fonctionne.
          </Notice>
        )}
        {entree === 'Réglages' ? <Settings />
          : entree === 'Cours' ? <Cours repo={repo} db={db} />
          : entree === 'Relire' ? <Review repo={repo} db={db} draft={draft} path={editPath} onGoto={(e) => setEntree(e)} />
          : entree === 'Générer' ? <Generate repo={repo} db={db} initialBrief={redo} onOpenDraft={(d) => { setDraft(d); setEditPath(null); setEntree('Relire'); }} />
          : <Library repo={repo} db={db} onEdit={(p) => { setEditPath(p); setDraft(null); setEntree('Relire'); }} onRedo={(b) => { setRedo(b); setEntree('Générer'); }} />}
      </main>
    </div>
  );
}
