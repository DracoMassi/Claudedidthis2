import { useEffect, useState, useSyncExternalStore } from 'react';
import { getJobs, subscribeJobs, type Job, type JobKind } from '../lib/jobs/store';

/** Tâches longues en cours ou terminées : elles survivent aux changements d'onglet. */
export const useJobs = () => useSyncExternalStore(subscribeJobs, getJobs, getJobs);
export const useJob = (kind: JobKind): Job | undefined => useJobs()[kind];

/** Heure courante rafraîchie chaque seconde tant que `active`, pour afficher « depuis 12 s ». */
export function useNow(active: boolean, every = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(t);
  }, [active, every]);
  return now;
}
