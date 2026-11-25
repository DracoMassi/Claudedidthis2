import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { splitPdf, type Lot } from '../src/lib/cours/chunk';
import { checkMarkdown } from '../src/lib/cours/checks';
import { ImportQueue } from '../src/lib/cours/queue';
import { verifyLot } from '../src/lib/cours/verify';
import { BlockedError, RateLimitError, ServerBusyError, TruncatedError } from '../src/lib/errors';
import { openDb } from '../src/lib/storage/db';

const lot = (i: number): Lot => ({ index: i, fromPage: i * 2 + 1, toPage: i * 2 + 2, data: new Uint8Array([i, 1, 2]), mime: 'image/png' });
const pages = (l: Lot) => Array.from({ length: l.toPage - l.fromPage + 1 }, (_, k) => `<!-- page ${l.fromPage + k} -->\nTexte suffisamment long.`).join('\n\n');
const verify = (l: Lot, md: string) => verifyLot(l, md, { extractText: async () => null });
const states = async (q: ImportQueue) => (await q.lotInfos('c')).map((i) => i.state);

describe('ImportQueue', () => {
  it('un lot incomplet est marqué suspect, puis repasse à ok quand on le relance', async () => {
    let bon = false;
    const q = new ImportQueue(await openDb(), async (l) => (l.index === 1 && !bon ? '<!-- page 3 -->\nTexte suffisamment long.' : pages(l)), verify);
    await q.enqueue('c', [lot(0), lot(1), lot(2)]);
    expect(await q.run('c')).toBe('done');
    expect(await states(q)).toEqual(['ok', 'suspect', 'ok']);
    bon = true;
    expect((await q.rerun('c', 1)).state).toBe('ok');
    await expect(q.rerun('c', 9)).rejects.toThrow('pas encore traité');
  });
  it('réseau ou quota : pause, ce qui est fait est gardé, les autres lots restent en attente', async () => {
    for (const err of [new ServerBusyError(529), new RateLimitError(10)]) {
      const q = new ImportQueue(await openDb(), async (l) => { if (l.index === 1) throw err; return pages(l); }, verify);
      await q.enqueue('c', [lot(0), lot(1), lot(2)]);
      expect(await q.run('c')).toBe('paused');
      expect(await states(q)).toEqual(['ok', 'pending', 'pending']);
    }
  });
  it('réponse tronquée : le lot est retranscrit page par page', async () => {
    const d = await PDFDocument.create();
    for (let i = 0; i < 3; i++) d.addPage([200, 200]);
    const u = await d.save();
    const [big] = await splitPdf(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer, 3);
    const appels: [number, number][] = [];
    const q = new ImportQueue(await openDb(), async (l) => {
      appels.push([l.fromPage, l.toPage]);
      if (l.toPage > l.fromPage) throw new TruncatedError();
      return `<!-- page ${l.fromPage} -->\nTexte suffisamment long.`;
    }, verify);
    await q.enqueue('c', [big]);
    expect(await q.run('c')).toBe('done');
    expect(appels).toEqual([[1, 3], [1, 1], [2, 2], [3, 3]]);
    expect((await q.lotInfos('c'))[0]).toMatchObject({ state: 'ok', split: true });
  });
  it('une page tronquée ou refusée : échec visible dans le texte, sans bloquer les lots suivants', async () => {
    const q = new ImportQueue(await openDb(), async (l) => {
      if (l.index === 0) throw new TruncatedError();
      if (l.index === 1) throw new BlockedError('SAFETY');
      return pages(l);
    }, verify);
    await q.enqueue('c', [{ ...lot(0), toPage: 1 }, lot(1), lot(2)]);
    expect(await q.run('c')).toBe('done');
    expect(await states(q)).toEqual(['failed', 'failed', 'ok']);
    expect((await q.lotInfos('c'))[1].notes?.join(' ')).toContain('SAFETY');
    expect(checkMarkdown(`# T\n${await q.markdown('c')}`).some((p) => p.message.includes('non transcrit'))).toBe(true);
  });
  it('événements de progression start/done, et comportement historique sans contrôle', async () => {
    const q = new ImportQueue(await openDb(), async (l) => `# lot ${l.index}`);
    await q.enqueue('c', [lot(0), lot(1)]);
    const ev: string[] = [];
    await q.run('c', (p) => ev.push(`${p.phase}${p.index + 1}/${p.total}`));
    expect(ev).toEqual(['start1/2', 'done1/2', 'start2/2', 'done2/2']);
    expect(await q.markdown('c')).toBe('# lot 0\n\n# lot 1');
  });
});
