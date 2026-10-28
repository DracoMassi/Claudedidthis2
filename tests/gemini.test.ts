import { describe, expect, it, vi } from 'vitest';
import { callGemini } from '../src/lib/gemini/client';
import { extractJson } from '../src/lib/gemini/json';
import { RequestBudget } from '../src/lib/gemini/budget';
import { AuthError, NetworkError, RateLimitError } from '../src/lib/errors';

const resp = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const call = (f: (u: string, i?: RequestInit) => Promise<Response>) =>
  callGemini({ key: 'K', model: 'm1', system: 'sys', messages: [{ role: 'user', text: 'salut' }], fetchImpl: vi.fn(f) as unknown as typeof fetch });

describe('extractJson', () => {
  it('retire les balises de code', () => expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 }));
  it('accepte du texte autour', () => expect(extractJson('Voici : {"a":1} fin')).toEqual({ a: 1 }));
  it('lève une erreur de code json sur une réponse tronquée', () => {
    expect(() => extractJson('{"a": 1, "b": [')).toThrowError(expect.objectContaining({ code: 'json' }));
  });
});

describe('callGemini', () => {
  it('renvoie le texte et envoie système, historique et clé', async () => {
    let seen: { url: string; body: any } | undefined;
    const t = await call(async (url, init) => {
      seen = { url, body: JSON.parse(String(init?.body)) };
      return resp(200, { candidates: [{ content: { parts: [{ text: '{"ok":' }, { text: 'true}' }] } }] });
    });
    expect(t).toBe('{"ok":true}');
    expect(seen?.url).toContain('/models/m1:generateContent');
    expect(seen?.url).toContain('key=K');
    expect(seen?.body.systemInstruction.parts[0].text).toBe('sys');
    expect(seen?.body.contents).toEqual([{ role: 'user', parts: [{ text: 'salut' }] }]);
    expect(seen?.body.generationConfig.responseMimeType).toBe('application/json');
  });
  it('429 donne RateLimitError avec retryAfterSec (en-tête)', async () => {
    await expect(call(async () => resp(429, {}, { 'retry-after': '12' }))).rejects.toMatchObject({ name: 'RateLimitError', retryAfterSec: 12 });
  });
  it('429 lit le délai du corps (retryDelay)', async () => {
    const body = { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7.2s' }] } };
    await expect(call(async () => resp(429, body))).rejects.toMatchObject({ retryAfterSec: 8 });
  });
  it('429 sans indication : 30 secondes', async () => {
    await expect(call(async () => resp(429))).rejects.toBeInstanceOf(RateLimitError);
    await expect(call(async () => resp(429))).rejects.toMatchObject({ retryAfterSec: 30 });
  });
  it('401 et 403 donnent AuthError', async () => {
    for (const s of [401, 403]) await expect(call(async () => resp(s))).rejects.toBeInstanceOf(AuthError);
  });
  it('un échec réseau (ou une erreur CORS) donne NetworkError, jamais AuthError', async () => {
    await expect(call(async () => { throw new TypeError('Failed to fetch'); })).rejects.toBeInstanceOf(NetworkError);
  });
  it('un 503 donne NetworkError', async () => {
    await expect(call(async () => resp(503))).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('RequestBudget', () => {
  it('bloque après perMinute envois dans la minute, libère 61 s plus tard', () => {
    let t = 0;
    const b = new RequestBudget({ perMinute: 5, perDay: 100 }, () => t);
    for (let i = 0; i < 5; i++) { expect(b.canSend()).toBe(true); b.record(); }
    expect(b.canSend()).toBe(false);
    expect(b.waitSeconds()).toBeGreaterThan(0);
    t = 61_000;
    expect(b.canSend()).toBe(true);
  });
  it('bloque au plafond quotidien', () => {
    let t = 0;
    const b = new RequestBudget({ perMinute: 100, perDay: 3 }, () => t);
    for (let i = 0; i < 3; i++) { t += 120_000; b.record(); }
    expect(b.canSend()).toBe(false);
    t += 24 * 3600_000;
    expect(b.canSend()).toBe(true);
  });
});
