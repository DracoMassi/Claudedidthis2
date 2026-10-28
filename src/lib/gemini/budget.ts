const MIN = 60_000;
const DAY = 24 * 3600_000;

/** Plafonds locaux de requêtes (protège le quota gratuit). Avec storageKey, l'historique survit au rechargement. */
export class RequestBudget {
  private limits: { perMinute: number; perDay: number };
  private now: () => number;
  private key?: string;
  private times: number[] = [];

  constructor(limits: { perMinute: number; perDay: number }, now: () => number = () => Date.now(), storageKey?: string) {
    this.limits = limits; this.now = now; this.key = storageKey;
    if (storageKey) {
      try {
        const raw = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown;
        if (Array.isArray(raw)) this.times = raw.filter((x): x is number => typeof x === 'number');
      } catch { /* historique illisible : on repart de zéro */ }
    }
  }
  private prune(): void { const c = this.now() - DAY; this.times = this.times.filter((t) => t > c); }
  private save(): void { if (this.key) try { localStorage.setItem(this.key, JSON.stringify(this.times)); } catch { /* ignoré */ } }

  canSend(): boolean {
    this.prune();
    const t = this.now();
    return this.times.filter((x) => x > t - MIN).length < this.limits.perMinute && this.times.length < this.limits.perDay;
  }
  record(): void { this.prune(); this.times.push(this.now()); this.save(); }
  used(): { day: number; limit: number } { this.prune(); return { day: this.times.length, limit: this.limits.perDay }; }
  waitSeconds(): number {
    this.prune();
    if (this.canSend()) return 0;
    const t = this.now();
    const inMin = this.times.filter((x) => x > t - MIN);
    let wait = 0;
    if (inMin.length >= this.limits.perMinute) wait = Math.max(wait, inMin[inMin.length - this.limits.perMinute] + MIN - t);
    if (this.times.length >= this.limits.perDay) wait = Math.max(wait, this.times[this.times.length - this.limits.perDay] + DAY - t);
    return Math.ceil(wait / 1000);
  }
}
