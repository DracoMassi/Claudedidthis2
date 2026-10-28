import { useEffect, useMemo, useState } from 'react';
import { GithubRepo } from '../lib/github/repo';
import { openDb, type Db } from '../lib/storage/db';
import { getSettings } from '../lib/storage/settings';

/** Dépôt privé configuré dans Réglages, ou null s'il manque le jeton, le propriétaire ou le nom. */
export function useRepo(): GithubRepo | null {
  const [v, setV] = useState(0);
  useEffect(() => {
    const f = () => setV((n) => n + 1);
    window.addEventListener('sequentia-settings-changed', f);
    return () => window.removeEventListener('sequentia-settings-changed', f);
  }, []);
  return useMemo(() => {
    const s = getSettings();
    return s.githubToken && s.owner && s.repo ? new GithubRepo(s.owner, s.repo, s.githubToken) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
}

export function useDb(): Db | null {
  const [db, setDb] = useState<Db | null>(null);
  useEffect(() => { void openDb().then(setDb); }, []);
  return db;
}
