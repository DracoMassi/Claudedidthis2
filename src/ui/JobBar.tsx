import type { JobKind } from '../lib/jobs/store';
import { dismissJob } from '../lib/jobs/store';
import type { Entree } from '../App';
import LiveProgress from './LiveProgress';
import { resumeNow, cancelAuto } from './runCours';
import { Notice } from './kit';
import { useJobs } from './useJobs';

const TAB: Record<JobKind, Entree> = { generate: 'Générer', cours: 'Cours' };

/**
 * Bandeau visible sur tous les onglets : tant qu'une tâche tourne (ou vient de finir) dans un autre onglet, on le voit ici
 * et on peut y retourner d'un geste. Dans l'onglet de la tâche, c'est l'écran lui-même qui affiche la progression.
 */
export default function JobBar({ entree, onGo }: { entree: Entree; onGo: (e: Entree) => void }) {
  const jobs = useJobs();
  const list = (Object.values(jobs).filter(Boolean) as NonNullable<(typeof jobs)[JobKind]>[])
    .filter((j) => TAB[j.kind] !== entree && !(j.dismissed && (j.state === 'done' || j.state === 'error')));
  if (!list.length) return null;
  return (
    <div className="jobbar" aria-label="Tâches en cours">
      {list.map((j) => {
        const label = j.kind === 'generate' ? `Fiche : ${j.title}` : `Import : ${j.title}`;
        if (j.state === 'running' || j.state === 'waiting') {
          return (
            <div key={j.kind} className="card jobcard">
              <div className="jobhead"><b>{label}</b><button className="btn ghost" onClick={() => onGo(TAB[j.kind])}>Voir</button></div>
              <LiveProgress job={j} onResume={j.kind === 'cours' ? resumeNow : undefined} onCancel={j.kind === 'cours' ? cancelAuto : undefined} />
            </div>
          );
        }
        return (
          <Notice key={j.kind} kind={j.outcome === 'ok' ? 'ok' : 'error'}
            action={<span className="jobacts"><button className="btn" onClick={() => onGo(TAB[j.kind])}>Ouvrir</button><button onClick={() => dismissJob(j.kind)}>Fermer</button></span>}>
            <b>{label}</b> · {j.message}
          </Notice>
        );
      })}
    </div>
  );
}
