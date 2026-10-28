import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { splitPdf, type Lot } from '../src/lib/cours/chunk';
import { checkMarkdown, buildCoursMd } from '../src/lib/cours/checks';
import { transcribeLot, transcriptionPrompt, transcribeWithGemini } from '../src/lib/cours/transcribe';
import { ImportQueue } from '../src/lib/cours/queue';
import { coursStatut } from '../src/lib/generate/sources';
import { openDb } from '../src/lib/storage/db';
import { RateLimitError } from '../src/lib/errors';

async function pdfDe(pages: number): Promise<ArrayBuffer> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([200, 200]);
  const b = await d.save();
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
const lot = (i: number, mime?: string): Lot => ({ index: i, fromPage: i * 5 + 1, toPage: i * 5 + 5, data: new Uint8Array([i, 1, 2]), ...(mime ? { mime } : {}) });

describe('splitPdf', () => {
  it('découpe 12 pages en 3 lots (1-5, 6-10, 11-12) lisibles', async () => {
    const lots = await splitPdf(await pdfDe(12), 5);
    expect(lots.map((l) => [l.fromPage, l.toPage])).toEqual([[1, 5], [6, 10], [11, 12]]);
    expect(lots.map((l) => l.index)).toEqual([0, 1, 2]);
    const tailles = await Promise.all(lots.map(async (l) => (await PDFDocument.load(l.data)).getPageCount()));
    expect(tailles).toEqual([5, 5, 2]);
  });
  it('refuse un lot de moins d’une page', async () => {
    await expect(splitPdf(await pdfDe(2), 0)).rejects.toThrow();
  });
});

describe('transcription', () => {
  it('le prompt cite la plage de pages et les règles de la spec §7.2', () => {
    const p = transcriptionPrompt(lot(1));
    expect(p).toContain('<!-- page N -->');
    expect(p).toContain('de 6 à 10');
    expect(p).toContain('[illisible]');
    expect(p).toContain('N\'invente rien');
    expect(p).toContain('légende entre crochets');
    expect(p).toContain('$');
  });
  it('transcribeLot retire les balises de code du Markdown renvoyé', async () => {
    const llm = vi.fn(async () => '```markdown\n# Titre\n```');
    expect(await transcribeLot(lot(0), { llm })).toBe('# Titre');
    expect(llm).toHaveBeenCalledWith(expect.objectContaining({ index: 0 }));
  });
  it('transcribeWithGemini envoie le PDF en base64 et le prompt', async () => {
    let body: any;
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '# ok' }] } }] }), { status: 200 });
    });
    const r = await transcribeWithGemini({ key: 'K', model: 'm', lot: lot(0), fetchImpl: f as unknown as typeof fetch });
    expect(r).toBe('# ok');
    const parts = body.contents[0].parts;
    expect(parts[0].inlineData.mimeType).toBe('application/pdf');
    expect(parts[0].inlineData.data).toBe(btoa(String.fromCharCode(0, 1, 2)));
    expect(parts[1].text).toContain('page');
    expect(body.generationConfig.responseMimeType).toBe('text/plain');
  });
  it('une photo part avec son type MIME', async () => {
    let body: any;
    const f = vi.fn(async (_u: string, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }), { status: 200 }); });
    await transcribeWithGemini({ key: 'K', model: 'm', lot: lot(0, 'image/jpeg'), fetchImpl: f as unknown as typeof fetch });
    expect(body.contents[0].parts[0].inlineData.mimeType).toBe('image/jpeg');
  });
});

describe('checkMarkdown', () => {
  it('signale une formule invalide', () => {
    const p = checkMarkdown('# T\nvoici $\\commandeinconnue{x}$ ici');
    expect(p.some((x) => x.code === 'katex' && x.message.includes('Undefined control sequence'))).toBe(true);
  });
  it('accepte les macros de la charte', () => {
    expect(checkMarkdown('# T\n$\\dd x$ et $\\inte{1}{n}$ et $\\R$')).toEqual([]);
  });
  it('signale l’absence de titre # et compte les [illisible]', () => {
    const p = checkMarkdown('## Sans titre principal\ntexte [illisible] et [illisible]');
    expect(p.some((x) => x.message.includes('titre'))).toBe(true);
    expect(p.some((x) => x.message.startsWith('2 passages [illisible]'))).toBe(true);
  });
  it('signale une page vide', () => {
    const p = checkMarkdown('# T\n<!-- page 1 -->\nun peu de texte ici\n<!-- page 2 -->\n\n<!-- page 3 -->\nsuite du cours');
    expect(p.some((x) => x.message.includes('page 2') && x.message.includes('vide'))).toBe(true);
    expect(p.some((x) => x.message.includes('page 1'))).toBe(false);
  });
  it('un cours propre ne donne aucun problème', () => {
    expect(checkMarkdown('# Continuité\n<!-- page 1 -->\n## Définition\nSoit $f$ continue sur $I$.')).toEqual([]);
  });
});

describe('buildCoursMd', () => {
  it('produit le front matter de la spec §5.2, relisible par coursStatut', () => {
    const md = buildCoursMd({ matiere: 'maths', niveau: 'mpsi', chapitre: 'Continuité', source: 'cours.pdf (p. 1-12)', statut: 'a_verifier' }, '# Continuité\n## A');
    expect(md.startsWith('---\nmatiere: maths\nniveau: mpsi\nchapitre: Continuité\nsource: cours.pdf (p. 1-12)\nstatut: a_verifier\n---\n')).toBe(true);
    expect(md.endsWith('# Continuité\n## A\n')).toBe(true);
    expect(coursStatut(md)).toBe('a_verifier');
  });
  it('protège une valeur contenant deux-points', () => {
    expect(buildCoursMd({ matiere: 'maths', niveau: 'mpsi', chapitre: 'Limites : définitions', source: 's', statut: 'verifie' }, 'x')).toContain('chapitre: "Limites : définitions"');
  });
});

describe('ImportQueue', () => {
  it('reprise après quota : pause au lot 3, puis ne retraite que les lots 3 et 4', async () => {
    const db = await openDb();
    const appels: number[] = [];
    let casse = true;
    const q = new ImportQueue(db, async (l) => {
      appels.push(l.index);
      if (l.index === 2 && casse) throw new RateLimitError(10);
      return `# lot ${l.index}`;
    });
    await q.enqueue('cours-1', [lot(0), lot(1), lot(2), lot(3)]);
    expect(await q.run('cours-1')).toBe('paused');
    expect(await q.progress('cours-1')).toEqual({ done: 2, total: 4 });
    casse = false;
    expect(await q.run('cours-1')).toBe('done');
    expect(appels).toEqual([0, 1, 2, 2, 3]);
    expect(await q.progress('cours-1')).toEqual({ done: 4, total: 4 });
    expect(await q.markdown('cours-1')).toBe('# lot 0\n\n# lot 1\n\n# lot 2\n\n# lot 3');
  });
  it('la progression survit à un nouvel objet ImportQueue (rechargement de la page)', async () => {
    const db = await openDb();
    const a = new ImportQueue(db, async (l) => { if (l.index === 1) throw new RateLimitError(5); return 'ok'; });
    await a.enqueue('c', [lot(0), lot(1)]);
    await a.run('c');
    const appels: number[] = [];
    const b = new ImportQueue(db, async (l) => { appels.push(l.index); return 'ok'; });
    expect(await b.progress('c')).toEqual({ done: 1, total: 2 });
    expect(await b.run('c')).toBe('done');
    expect(appels).toEqual([1]);
  });
});
