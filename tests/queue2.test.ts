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

describe('ImportQueue : contrôle de chaque lot', () => {
  it('marque suspect le lot dont il manque une page, et garde les autres vérifiés', async () => {
    const q = new ImportQueue(await openDb(), async (l) => (l.index === 1 ? `<!-- page 3 -->\nTexte suffisamment long.` : pages(l)), verify);
    await q.enqueue('c', [lot(0), lot(1), lot(2)]);
    expect(await q.run('c')).toBe('done');
    const infos = await q.lotInfos('c');
    expect(infos.map((i) => i.state)).toEqual(['ok', 'suspect', 'ok']);
    expect(infos[1].missing).toEqual([4]);
  });
  it('un lot relancé repasse à ok quand la nouvelle transcription est complète', async () => {
    let bon = false;
    const q = new ImportQueue(await openDb(), async (l) => (l.index === 0 && !bon ? `<!-- page 1 -->\nTexte suffisamment long.` : pages(l)), verify);
    await q.enqueue('c', [lot(0), lot(1)]);
    await q.run('c');
    expect((await q.lotInfos('c'))[0].state).toBe('suspect');
    bon = true;
    expect((await q.rerun('c', 0)).state).toBe('ok');
    expect((await q.lotInfos('c')).map((i) => i.state)).toEqual(['ok', 'ok']);
  });
  it('les lots pas encore traités sont en attente ; la pause garde ce qui est fait', async () => {
    const q = new ImportQueue(await openDb(), async (l) => { if (l.index === 1) throw new ServerBusyError(529); return pages(l); }, verify);
    await q.enqueue('c', [lot(0), lot(1), lot(2)]);
    expect(await q.run('c')).toBe('paused');
    expect((await q.lotInfos('c')).map((i) => i.state)).toEqual(['ok', 'pending', 'pending']);
  });
  it('un quota fait aussi une pause', async () => {
    const q = new ImportQueue(await openDb(), async () => { throw new RateLimitError(10); }, verify);
    await q.enqueue('c', [lot(0)]);
    expect(await q.run('c')).toBe('paused');
  });
  it("rerun refuse un lot qui n'a pas encore été traité", async () => {
    const q = new ImportQueue(await openDb(), async (l) => pages(l), verify);
    await q.enqueue('c', [lot(0)]);
    await expect(q.rerun('c', 0)).rejects.toThrow('pas encore traité');
  });
  it('sans fonction de contrôle, le comportement historique est conservé', async () => {
    const q = new ImportQueue(await openDb(), async (l) => `# lot ${l.index}`);
    await q.enqueue('c', [lot(0), lot(1)]);
    expect(await q.run('c')).toBe('done');
    expect(await q.markdown('c')).toBe('# lot 0\n\n# lot 1');
  });
});

describe('ImportQueue : réponse tronquée', () => {
  it('retranscrit le lot page par page et le signale', async () => {
    const b = await (async () => { const d = await PDFDocument.create(); for (let i = 0; i < 3; i++) d.addPage([200, 200]); const u = await d.save(); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; })();
    const [big] = await splitPdf(b, 3);
    const appels: [number, number][] = [];
    const q = new ImportQueue(await openDb(), async (l) => {
      appels.push([l.fromPage, l.toPage]);
      if (l.toPage > l.fromPage) throw new TruncatedError();
      return `<!-- page ${l.fromPage} -->\nTexte suffisamment long.`;
    }, verify);
    await q.enqueue('c', [big]);
    expect(await q.run('c')).toBe('done');
    expect(appels).toEqual([[1, 3], [1, 1], [2, 2], [3, 3]]);
    const [info] = await q.lotInfos('c');
    expect(info.state).toBe('ok');
    expect(info.split).toBe(true);
    expect(await q.markdown('c')).toContain('<!-- page 3 -->');
  });
  it('une seule page tronquée : lot en échec, avec un repère visible dans le texte', async () => {
    const q = new ImportQueue(await openDb(), async () => { throw new TruncatedError(); }, verify);
    await q.enqueue('c', [{ index: 0, fromPage: 1, toPage: 1, data: new Uint8Array([1]), mime: 'image/png' }]);
    expect(await q.run('c')).toBe('done');
    expect((await q.lotInfos('c'))[0].state).toBe('failed');
    const md = await q.markdown('c');
    expect(md).toContain('[lot non transcrit');
    expect(checkMarkdown(`# T\n${md}`).some((p) => p.message.includes('non transcrit'))).toBe(true);
  });
  it('contenu refusé : lot en échec avec le motif, sans bloquer les suivants', async () => {
    const q = new ImportQueue(await openDb(), async (l) => { if (l.index === 0) throw new BlockedError('SAFETY'); return pages(l); }, verify);
    await q.enqueue('c', [lot(0), lot(1)]);
    expect(await q.run('c')).toBe('done');
    const infos = await q.lotInfos('c');
    expect(infos.map((i) => i.state)).toEqual(['failed', 'ok']);
    expect(infos[0].notes?.join(' ')).toContain('SAFETY');
  });
});
