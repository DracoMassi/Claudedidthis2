/** Journal des appels à Gemini (derniers essais), pour comprendre pourquoi une requête a échoué. */
export type AttemptEvent = {
  t: number; model: string; attempt: number;
  outcome: 'ok' | 'busy' | 'quota' | 'network' | 'auth' | 'other';
  status?: number; waitMs?: number; ms?: number; message?: string;
};

const KEY = 'sequentia.journal';
const MAX = 40;
let memory: AttemptEvent[] = [];

function read(): AttemptEvent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? (raw as AttemptEvent[]) : [];
  } catch { return memory; }
}
function write(list: AttemptEvent[]): void {
  memory = list;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* stockage indisponible : copie en mémoire seulement */ }
}

export function logAttempt(e: AttemptEvent): void { write([...read(), e].slice(-MAX)); }
export function recentAttempts(): AttemptEvent[] { return read(); }
export function clearJournal(): void { write([]); }
