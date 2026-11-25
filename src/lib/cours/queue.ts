import { BlockedError, NetworkError, RateLimitError, TruncatedError } from '../errors';
import { fromBase64, toBase64 } from '../bytes';
import type { Db } from '../storage/db';
import { splitPdf, type Lot } from './chunk';
import type { LotCheck } from './verify';

type StoredLot = { index: number; fromPage: number; toPage: number; mime?: string; b64: string };
export type LotStatus = {
  state: 'pending' | 'ok' | 'suspect' | 'failed';
  coverage?: number; missing?: number[]; notes?: string[];
  /** Le lot a été redécoupé page par page après une réponse tronquée. */
  split?: boolean;
};
export type LotInfo = LotStatus & { index: number; fromPage: number; toPage: number };
export type Verify = (lot: Lot, md: string) => Promise<LotCheck>;
/** Événement de progression : un lot commence (`start`) ou vient d'être traité (`done`, avec son verdict). */
export type QueueProgress = { index: number; total: number; phase: 'start' | 'done'; state?: LotStatus['state'] };
type State = { lots: StoredLot[]; results: string[]; next: number; status?: LotStatus[] };
const key = (id: string) => `import:${id}`;
const INDEX = 'import:index';

const isPdf = (l: { mime?: string }) => !l.mime || l.mime.includes('pdf');
const placeholder = (l: StoredLot) => `<!-- page ${l.fromPage} -->\n[lot non transcrit : pages ${l.fromPage} à ${l.toPage}]`;

/** File d'import reprenable : la progression, les lots et le verdict de chaque lot sont enregistrés après chaque lot. */
export class ImportQueue {
  private db: Db;
  private transcribe: (lot: Lot) => Promise<string>;
  private verify?: Verify;
  constructor(db: Db, transcribe: (lot: Lot) => Promise<string>, verify?: Verify) { this.db = db; this.transcribe = transcribe; this.verify = verify; }

  private async load(id: string): Promise<State> {
    const st = (await this.db.get(key(id))) as State | undefined;
    if (!st) throw new Error(`Import inconnu : ${id}`);
    return st;
  }
  private save(id: string, st: State): Promise<void> { return this.db.put(key(id), st); }
  async ids(): Promise<string[]> { return ((await this.db.get(INDEX)) as string[] | undefined) ?? []; }

  async enqueue(id: string, lots: Lot[]): Promise<void> {
    const st: State = {
      lots: lots.map((l) => ({ index: l.index, fromPage: l.fromPage, toPage: l.toPage, mime: l.mime, b64: toBase64(l.data) })),
      results: lots.map(() => ''), next: 0, status: lots.map(() => ({ state: 'pending' })),
    };
    await this.save(id, st);
    const ids = await this.ids();
    if (!ids.includes(id)) await this.db.put(INDEX, [...ids, id]);
  }

  private toLot(s: StoredLot): Lot { return { index: s.index, fromPage: s.fromPage, toPage: s.toPage, mime: s.mime, data: fromBase64(s.b64) }; }

  /** Transcrit un lot, le contrôle, et enregistre résultat + verdict. Quota ou réseau : l'erreur remonte. */
  private async process(st: State, i: number): Promise<void> {
    const s = st.lots[i];
    const lot = this.toLot(s);
    st.status ??= [];
    let md: string;
    let split = false;
    try {
      try {
        md = await this.transcribe(lot);
      } catch (e) {
        // Réponse coupée : on retranscrit page par page plutôt que d'accepter un texte incomplet.
        if (!(e instanceof TruncatedError) || lot.toPage <= lot.fromPage || !isPdf(lot)) throw e;
        const buf = lot.data.buffer.slice(lot.data.byteOffset, lot.data.byteOffset + lot.data.byteLength) as ArrayBuffer;
        const parts: string[] = [];
        for (const p of await splitPdf(buf, 1)) {
          parts.push(await this.transcribe({ ...p, index: lot.index, fromPage: lot.fromPage + p.fromPage - 1, toPage: lot.fromPage + p.toPage - 1 }));
        }
        md = parts.join('\n\n');
        split = true;
      }
    } catch (e) {
      if (e instanceof TruncatedError || e instanceof BlockedError) {
        st.results[i] = placeholder(s);
        st.status[i] = { state: 'failed', notes: [e instanceof BlockedError ? `Contenu refusé par Gemini (${e.reason})` : 'Réponse tronquée : réduis le nombre de pages par lot dans Réglages'] };
        return;
      }
      throw e;
    }
    let chk: LotCheck = { state: 'ok', missing: [], weak: [], notes: [] };
    if (this.verify) {
      try { chk = await this.verify(lot, md); } catch { chk = { state: 'ok', missing: [], weak: [], notes: ['Contrôle automatique impossible'] }; }
    }
    st.results[i] = md;
    st.status[i] = { state: chk.state, coverage: chk.coverage, missing: chk.missing, notes: chk.notes, ...(split ? { split: true } : {}) };
  }

  /** Traite les lots restants. Quota ou réseau : s'arrête avec 'paused' sans perdre ce qui est fait. */
  async run(id: string, onProgress?: (p: QueueProgress) => void): Promise<'done' | 'paused'> {
    const st = await this.load(id);
    for (let i = st.next; i < st.lots.length; i++) {
      onProgress?.({ index: i, total: st.lots.length, phase: 'start' });
      try {
        await this.process(st, i);
      } catch (e) {
        if (e instanceof RateLimitError || e instanceof NetworkError) return 'paused';
        throw e;
      }
      st.next = i + 1;
      await this.save(id, st);
      onProgress?.({ index: i, total: st.lots.length, phase: 'done', state: st.status?.[i]?.state });
    }
    return 'done';
  }

  /** Relance un seul lot déjà traité (suspect ou en échec) ; les erreurs de quota et de réseau remontent à l'appelant. */
  async rerun(id: string, i: number, onProgress?: (p: QueueProgress) => void): Promise<LotStatus> {
    const st = await this.load(id);
    if (i < 0 || i >= st.next) throw new Error(`Lot ${i} pas encore traité`);
    onProgress?.({ index: i, total: st.lots.length, phase: 'start' });
    await this.process(st, i);
    await this.save(id, st);
    return st.status?.[i] ?? { state: 'ok' };
  }

  async progress(id: string): Promise<{ done: number; total: number }> {
    const st = await this.load(id);
    return { done: st.next, total: st.lots.length };
  }
  /** État de chaque lot : en attente, lu et vérifié, suspect, ou en échec. */
  async lotInfos(id: string): Promise<LotInfo[]> {
    const st = await this.load(id);
    return st.lots.map((l, i) => ({
      index: l.index, fromPage: l.fromPage, toPage: l.toPage,
      ...(i >= st.next ? { state: 'pending' as const } : (st.status?.[i] ?? { state: 'ok' as const })),
    }));
  }
  async lots(id: string): Promise<Lot[]> {
    const st = await this.load(id);
    return st.lots.map((l) => this.toLot(l));
  }
  async markdown(id: string): Promise<string> {
    const st = await this.load(id);
    return st.results.slice(0, st.next).join('\n\n');
  }
  async remove(id: string): Promise<void> {
    await this.db.put(key(id), undefined);
    await this.db.put(INDEX, (await this.ids()).filter((x) => x !== id));
  }
}
