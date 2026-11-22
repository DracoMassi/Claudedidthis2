import { describe, expect, it, vi } from 'vitest';
import { postGeminiDetailed } from '../src/lib/gemini/client';
import { RequestBudget } from '../src/lib/gemini/budget';
import { modelsOf, robustPost } from '../src/lib/gemini/robust';
import { transcribeRobust } from '../src/lib/cours/transcribe';
import { BlockedError, NetworkError, RateLimitError, ServerBusyError, TruncatedError } from '../src/lib/errors';
import { messageFor } from '../src/ui/messages';

const resp = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (text: string, finishReason = 'STOP') => resp(200, { candidates: [{ finishReason, content: { parts: [{ text }] } }] });
const post = (f: () => Promise<Response>) => postGeminiDetailed({ key: 'K', model: 'm', body: {}, fetchImpl: vi.fn(f) as unknown as typeof fetch });
const lot = { index: 0, fromPage: 1, toPage: 2, data: new Uint8Array([1, 2, 3]) };

describe('postGeminiDetailed', () => {
  it('529, 503, 500, 502 et 504 donnent ServerBusyError avec le code', async () => {
    for (const s of [500, 502, 503, 504, 529]) await expect(post(async () => resp(s))).rejects.toMatchObject({ name: 'ServerBusyError', status: s });
  });
  it('ServerBusyError reste une NetworkError', async () => {
    await expect(post(async () => resp(529))).rejects.toBeInstanceOf(NetworkError);
  });
  it('renvoie la raison d\'arrêt', async () => {
    expect(await post(async () => ok('x', 'MAX_TOKENS'))).toEqual({ text: 'x', finishReason: 'MAX_TOKENS' });
  });
  it('contenu bloqué : BlockedError', async () => {
    await expect(post(async () => resp(200, { promptFeedback: { blockReason: 'SAFETY' } }))).rejects.toBeInstanceOf(BlockedError);
  });
  it('réponse vide sans motif : NetworkError', async () => {
    await expect(post(async () => resp(200, { candidates: [{ content: { parts: [] } }] }))).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('robustPost', () => {
  const fast = { sleep: async () => {}, random: () => 0, log: () => {} };
  it('529 puis succès : la tentative en échec est remboursée dans le budget', async () => {
    const budget = new RequestBudget({ perMinute: 10, perDay: 100 });
    const seq = [resp(529), ok('{"a":1}')];
    const f = vi.fn(async () => seq.shift() as Response);
    const r = await robustPost({ key: 'K', models: ['m'], budget, fetchImpl: f as unknown as typeof fetch, retry: fast }, {});
    expect(r.text).toBe('{"a":1}');
    expect(f).toHaveBeenCalledTimes(2);
    expect(budget.used().day).toBe(1);
  });
  it('plafond local atteint pour longtemps : aucun appel réseau', async () => {
    const budget = new RequestBudget({ perMinute: 1, perDay: 100 });
    budget.record();
    const f = vi.fn();
    await expect(robustPost({ key: 'K', models: ['m'], budget, fetchImpl: f as unknown as typeof fetch, retry: fast }, {})).rejects.toBeInstanceOf(RateLimitError);
    expect(f).not.toHaveBeenCalled();
  });
  it('modèle principal surchargé : le secours répond', async () => {
    const urls: string[] = [];
    const f = vi.fn(async (u: string) => { urls.push(u); return u.includes('/models/p:') ? resp(529) : ok('ok'); });
    const r = await robustPost({ key: 'K', models: ['p', 's'], fetchImpl: f as unknown as typeof fetch, retry: fast }, {});
    expect(r.text).toBe('ok');
    expect(urls.filter((u) => u.includes('/models/p:')).length).toBe(4);
    expect(urls.filter((u) => u.includes('/models/s:')).length).toBe(1);
  });
});

describe('modelsOf', () => {
  it('principal puis secours, sans vide ni espace', () => {
    expect(modelsOf({ model: 'a', modelSecours: ' b ' })).toEqual(['a', 'b']);
    expect(modelsOf({ model: 'a', modelSecours: '' })).toEqual(['a']);
  });
});

describe('transcribeRobust', () => {
  const fast = { sleep: async () => {}, random: () => 0, log: () => {} };
  it('refuse une transcription coupée (MAX_TOKENS)', async () => {
    const f = vi.fn(async () => ok('# début…', 'MAX_TOKENS'));
    await expect(transcribeRobust({ cfg: { key: 'K', models: ['m'], fetchImpl: f as unknown as typeof fetch, retry: fast }, lot })).rejects.toBeInstanceOf(TruncatedError);
  });
  it('renvoie le texte quand tout va bien', async () => {
    const f = vi.fn(async () => ok('# Cours'));
    expect(await transcribeRobust({ cfg: { key: 'K', models: ['m'], fetchImpl: f as unknown as typeof fetch, retry: fast }, lot })).toBe('# Cours');
  });
});

describe('messageFor', () => {
  it('distingue surcharge, coupure et contenu refusé', () => {
    expect(messageFor(new ServerBusyError(529))).toContain('surchargé (529)');
    expect(messageFor(new TruncatedError())).toContain('Réduis le nombre de pages');
    expect(messageFor(new BlockedError('SAFETY'))).toContain('SAFETY');
    expect(messageFor(new NetworkError())).toBe("Gemini n'a pas répondu. Réessayer");
  });
});
