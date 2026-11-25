import { describe, expect, it, vi } from 'vitest';
import { postGeminiDetailed } from '../src/lib/gemini/client';
import { RequestBudget } from '../src/lib/gemini/budget';
import { modelsOf, robustPost } from '../src/lib/gemini/robust';
import { transcribeRobust } from '../src/lib/cours/transcribe';
import { BlockedError, NetworkError, RateLimitError, ServerBusyError, TruncatedError } from '../src/lib/errors';
import { messageFor } from '../src/ui/messages';

const resp = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const ok = (text: string, finishReason = 'STOP') => resp(200, { candidates: [{ finishReason, content: { parts: [{ text }] } }] });
const asFetch = (f: unknown) => f as typeof fetch;
const post = (r: () => Response) => postGeminiDetailed({ key: 'K', model: 'm', body: {}, fetchImpl: asFetch(async () => r()) });
const fast = { sleep: async () => {}, random: () => 0, log: () => {} };
const lot = { index: 0, fromPage: 1, toPage: 2, data: new Uint8Array([1, 2, 3]) };

describe('client Gemini', () => {
  it('traduit les réponses : surcharge (code conservé), raison d\'arrêt, contenu refusé, réponse vide', async () => {
    for (const s of [500, 502, 503, 504, 529]) await expect(post(() => resp(s))).rejects.toMatchObject({ name: 'ServerBusyError', status: s });
    await expect(post(() => resp(529))).rejects.toBeInstanceOf(NetworkError);
    expect(await post(() => ok('x', 'MAX_TOKENS'))).toEqual({ text: 'x', finishReason: 'MAX_TOKENS' });
    await expect(post(() => resp(200, { promptFeedback: { blockReason: 'SAFETY' } }))).rejects.toBeInstanceOf(BlockedError);
    await expect(post(() => resp(200, { candidates: [{ content: { parts: [] } }] }))).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('robustPost', () => {
  it('529 puis succès : la tentative refusée est remboursée dans le budget', async () => {
    const budget = new RequestBudget({ perMinute: 10, perDay: 100 });
    const seq = [resp(529), ok('{"a":1}')];
    const f = vi.fn(async () => seq.shift() as Response);
    expect((await robustPost({ key: 'K', models: ['m'], budget, fetchImpl: asFetch(f), retry: fast }, {})).text).toBe('{"a":1}');
    expect(budget.used().day).toBe(1);
  });
  it('principal surchargé : 4 essais puis le secours ; plafond local atteint : aucun appel', async () => {
    const urls: string[] = [];
    const f = vi.fn(async (u: string) => { urls.push(u); return u.includes('/models/p:') ? resp(529) : ok('ok'); });
    expect((await robustPost({ key: 'K', models: ['p', 's'], fetchImpl: asFetch(f), retry: fast }, {})).text).toBe('ok');
    expect(urls.filter((u) => u.includes('/models/p:'))).toHaveLength(4);
    const budget = new RequestBudget({ perMinute: 1, perDay: 100 });
    budget.record();
    const g = vi.fn();
    await expect(robustPost({ key: 'K', models: ['m'], budget, fetchImpl: asFetch(g), retry: fast }, {})).rejects.toBeInstanceOf(RateLimitError);
    expect(g).not.toHaveBeenCalled();
  });
});

describe('transcription, bascule et messages', () => {
  it('une réponse coupée est refusée, une réponse complète est renvoyée', async () => {
    const cfg = (f: unknown) => ({ key: 'K', models: ['m'], fetchImpl: asFetch(f), retry: fast });
    await expect(transcribeRobust({ cfg: cfg(async () => ok('# début', 'MAX_TOKENS')), lot })).rejects.toBeInstanceOf(TruncatedError);
    expect(await transcribeRobust({ cfg: cfg(async () => ok('# Cours')), lot })).toBe('# Cours');
  });
  it('modelsOf (bascule) et messages d\'erreur distincts', () => {
    expect(modelsOf({ model: 'a', modelSecours: ' b ' })).toEqual(['a', 'b']);
    expect(modelsOf({ model: 'a', modelSecours: 'b', modeleActif: 'secours' })).toEqual(['b', 'a']);
    expect(modelsOf({ model: 'a', modelSecours: '', modeleActif: 'secours' })).toEqual(['a']);
    expect(messageFor(new ServerBusyError(529))).toContain('surchargé (529)');
    expect(messageFor(new TruncatedError())).toContain('Réduis le nombre de pages');
    expect(messageFor(new BlockedError('SAFETY'))).toContain('SAFETY');
  });
});
