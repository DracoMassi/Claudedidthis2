import { useEffect, useState } from 'react';
import Cours from './ui/Cours';
import Generate from './ui/Generate';
import JobBar from './ui/JobBar';
import { useJobs } from './ui/useJobs';
import { EMPTY_REFS, loadRefs, mergeRef, saveRefs, type Ref, type RefSet } from './lib/generate/refs';
import type { JobKind } from './lib/jobs/store';
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
/** Onglet qui affiche lui-même la progression de chaque type de tâche. */
const TAB_OF: Partial<Record<Entree, JobKind>> = { Générer: 'generate', Cours: 'cours' };

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
  const [refs, setRefs] = useState<RefSet>(EMPTY_REFS);
  const jobs = useJobs();
  const active = Object.values(jobs).find((j) => j && (j.state === 'running' || j.state === 'waiting'));
  const [, setTick] = useState(0);
  const quadrille = entree !== 'Relire';

  useEffect(() => { if (db) void db.listDrafts().then((l) => setNbDrafts(l.length)); }, [db, entree]);
  useEffect(() => {
    const f = () => setTick((n) => n + 1);
    window.addEventListener('sequentia-settings-changed', f);
    return () => window.removeEventListener('sequentia-settings-changed', f);
  }, []);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [entree]);
  // Le titre de l'onglet du navigateur montre l'avancement même quand on regarde ailleurs.
  const activeLabel = active ? `${active.kind === 'generate' ? 'Tour' : 'Lot'} ${active.step}/${active.steps}` : '';
  useEffect(() => { document.title = `${active ? `⏳ ${activeLabel} · ` : ''}${entree} · Séquentia`; }, [entree, active, activeLabel]);
  // Recharger la page pendant une tâche la ferait perdre : on prévient.
  useEffect(() => {
    if (!active) return;
    const f = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, [active]);
  useEffect(() => { if (db) void loadRefs(db).then(setRefs); }, [db]);
  const changeRefs = (next: RefSet) => { setRefs(next); if (db) void saveRefs(db, next); };
  const sendRef = (ref: Ref) => { changeRefs(mergeRef(refs, ref)); setEntree('Générer'); };

  const s = getSettings();
  const manque = !repo ? 'ton jeton GitHub et ton dépôt' : !s.geminiKey ? 'ta clé Gemini' : '';

  return (
    <div className={`app${quadrille ? ' grid-bg' : ''}`}>
      <div className="topbar"><div className="logo">sequentia</div></div>
      <nav className="nav" aria-label="Navigation">
        {ENTREES.map((e) => (
          <button key={e} aria-current={e === entree ? 'page' : undefined} onClick={() => setEntree(e)}>
            {e}
            {TAB_OF[e] && jobs[TAB_OF[e] as JobKind] && (jobs[TAB_OF[e] as JobKind]?.state === 'running' || jobs[TAB_OF[e] as JobKind]?.state === 'waiting') && <span className="live" role="img" aria-label="tâche en cours" />}
            {e === 'Générer' && nbDrafts > 0 && <span className="dot" aria-label={`${nbDrafts} brouillon${nbDrafts > 1 ? 's' : ''}`}>{nbDrafts}</span>}
          </button>
        ))}
      </nav>
      <JobBar entree={entree} onGo={setEntree} />
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
          : entree === 'Générer' ? <Generate repo={repo} db={db} initialBrief={redo} refs={refs} onRefsChange={changeRefs} onGoLibrary={() => setEntree('Bibliothèque')} onOpenDraft={(d) => { setDraft(d); setEditPath(null); setEntree('Relire'); }} />
          : <Library repo={repo} db={db} onEdit={(p) => { setEditPath(p); setDraft(null); setEntree('Relire'); }} onRedo={(b) => { setRedo(b); setEntree('Générer'); }} onSendRefs={sendRef} />}
      </main>
    </div>
  );
}
