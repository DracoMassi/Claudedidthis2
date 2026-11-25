import type { Job } from '../lib/jobs/store';
import { Stepper } from './kit';
import { StatusBadge } from './status';
import { useNow } from './useJobs';

const fmt = (sec: number) => (sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')} s`);

/**
 * Progression d'une tâche longue : phrase d'état, étapes, temps écoulé qui défile chaque seconde et barre animée.
 * Le temps qui avance prouve que l'appli travaille, même quand Gemini met longtemps à répondre.
 */
export default function LiveProgress({ job, onResume, onCancel }: { job: Job; onResume?: () => void; onCancel?: () => void }) {
  const active = job.state === 'running' || job.state === 'waiting';
  const now = useNow(active);
  const since = Math.max(0, Math.round((now - job.since) / 1000));
  const total = Math.max(0, Math.round((now - job.startedAt) / 1000));
  const waiting = job.state === 'waiting';
  const unit = job.kind === 'generate' ? 'Tour' : 'Lot';
  const left = waiting && job.resumeAt ? Math.max(0, Math.ceil((job.resumeAt - now) / 1000)) : 0;
  return (
    <div className="liveprog" data-waiting={waiting || undefined}>
      <div className="liveprog-head">
        <StatusBadge state={waiting ? 'retry' : 'running'}>{waiting ? 'En attente' : 'En cours'}</StatusBadge>
        <b role="status" aria-live="polite">{job.message}</b>
      </div>
      {job.step > 0 && <Stepper current={job.step} total={job.steps} label={`${unit} ${job.step} sur ${job.steps}`} />}
      {!waiting && <div className="indeterminate" aria-hidden="true"><i /></div>}
      <small className="liveprog-time" aria-hidden="true">
        {job.step > 0 ? `${unit} ${job.step} sur ${job.steps} · ` : ''}étape en cours depuis {fmt(since)} · total {fmt(total)}
        {waiting ? ` · reprise dans ${fmt(left)}` : ''}
        {!waiting && since >= 45 ? ' · Gemini met du temps à répondre, la requête est toujours en cours' : ''}
      </small>
      {waiting && (onResume || onCancel) && (
        <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
          {onResume && <button className="btn" onClick={onResume}>Reprendre maintenant</button>}
          {onCancel && <button onClick={onCancel}>Annuler la reprise</button>}
        </div>
      )}
    </div>
  );
}
