import type { Problem } from '../types';

/**
 * Tâches longues (génération d'une fiche, transcription d'un import) : leur état vit ici, hors des composants,
 * pour que la progression reste visible et exacte quand on change d'onglet. Une tâche par type.
 */
export type JobKind = 'generate' | 'cours';
/** running : en cours ; waiting : pause avant une reprise automatique ; done / error : terminée. */
export type JobState = 'running' | 'waiting' | 'done' | 'error';
export type Job = {
  kind: JobKind; title: string; state: JobState;
  /** Étape en cours (tour de génération ou lot d'import), à partir de 1 ; 0 avant le début. */
  step: number; steps: number;
  /** Phrase d'état du moment : « Tour 2 sur 4 : envoi à Gemini… », « Serveur surchargé, nouvel essai dans 2 s ». */
  message: string;
  startedAt: number;
  /** Début de l'étape ou du message en cours : sert à afficher « depuis 12 s ». */
  since: number;
  updatedAt: number;
  /** Reprise automatique prévue à cette heure (state = waiting). */
  resumeAt?: number;
  outcome?: 'ok' | 'warn' | 'error';
  /** Identifiant de ce que la tâche produit ou traite (brouillon, import). */
  ref?: string;
  problems?: Problem[];
  dismissed?: boolean;
};

type Snapshot = Partial<Record<JobKind, Job>>;
let snapshot: Snapshot = {};
const subs = new Set<() => void>();

function put(kind: JobKind, job: Job | undefined): void {
  const next = { ...snapshot };
  if (job) next[kind] = job; else delete next[kind];
  snapshot = next; // nouvel objet à chaque changement : useSyncExternalStore détecte la mise à jour
  subs.forEach((f) => f());
}

export const getJobs = (): Snapshot => snapshot;
export const getJob = (kind: JobKind): Job | undefined => snapshot[kind];
export const subscribeJobs = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const isRunning = (kind: JobKind): boolean => snapshot[kind]?.state === 'running';
export const isActive = (kind: JobKind): boolean => { const s = snapshot[kind]?.state; return s === 'running' || s === 'waiting'; };
export const resetJobs = (): void => put('generate', undefined) ?? put('cours', undefined);

export function startJob(kind: JobKind, o: { title: string; steps: number; message: string; ref?: string }): Job {
  const t = Date.now();
  const job: Job = { kind, title: o.title, state: 'running', step: 0, steps: o.steps, message: o.message, startedAt: t, since: t, updatedAt: t, ref: o.ref };
  put(kind, job);
  return job;
}

export function updateJob(kind: JobKind, patch: Partial<Pick<Job, 'step' | 'steps' | 'message' | 'state' | 'resumeAt' | 'ref'>>): void {
  const cur = snapshot[kind];
  if (!cur) return;
  const t = Date.now();
  const moved = (patch.message !== undefined && patch.message !== cur.message) || (patch.step !== undefined && patch.step !== cur.step);
  put(kind, { ...cur, ...patch, updatedAt: t, since: moved ? t : cur.since, ...('resumeAt' in patch ? {} : { resumeAt: undefined }) });
}

export function finishJob(kind: JobKind, o: { state: 'done' | 'error'; outcome: 'ok' | 'warn' | 'error'; message: string; problems?: Problem[]; ref?: string }): void {
  const cur = snapshot[kind];
  if (!cur) return;
  const t = Date.now();
  put(kind, { ...cur, state: o.state, outcome: o.outcome, message: o.message, problems: o.problems, ref: o.ref ?? cur.ref, updatedAt: t, since: t, resumeAt: undefined, dismissed: false });
}

export function dismissJob(kind: JobKind): void {
  const cur = snapshot[kind];
  if (cur) put(kind, { ...cur, dismissed: true });
}
