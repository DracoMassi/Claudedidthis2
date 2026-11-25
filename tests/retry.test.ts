import { describe, expect, it } from 'vitest';
import { withRetry } from '../src/lib/gemini/retry';
import { AuthError, NetworkError, RateLimitError, ServerBusyError } from '../src/lib/errors';

function setup(models: string[]) {
  const sleeps: number[] = [];
  const events: string[] = [];
  return { sleeps, events, o: { models, sleep: async (ms: number) => { sleeps.push(ms); }, random: () => 0, log: () => {}, onEvent: (e: { message: string }) => events.push(e.message) } };
}

describe('withRetry', () => {
  it('529 : attentes de 1, 2, 4 s, puis bascule sur le secours', async () => {
    let t = setup(['a']), n = 0;
    expect(await withRetry(async () => { if (++n < 3) throw new ServerBusyError(529); return 'ok'; }, t.o)).toBe('ok');
    expect(t.sleeps).toEqual([1000, 2000]);
    t = setup(['a', 'b']);
    const calls: string[] = [];
    expect(await withRetry(async (m) => { calls.push(m); if (m === 'a') throw new ServerBusyError(529); return m; }, t.o)).toBe('b');
    expect(calls).toEqual(['a', 'a', 'a', 'a', 'b']);
    expect(t.sleeps).toEqual([1000, 2000, 4000]);
    expect(t.events.some((m) => m.includes('bascule sur b'))).toBe(true);
  });
  it("si tout échoue, relance l'erreur du principal, même quand le secours échoue autrement", async () => {
    const { o } = setup(['a', 'b']);
    await expect(withRetry(async (m) => { throw m === 'a' ? new ServerBusyError(529) : new NetworkError('404'); }, o)).rejects.toMatchObject({ status: 529 });
  });
  it('clé refusée, erreur inconnue, plafond local long : arrêt immédiat, sans secours', async () => {
    for (const err of [new AuthError(), new Error('boum'), new RateLimitError(60, true)]) {
      const { o } = setup(['a', 'b']);
      let n = 0;
      await expect(withRetry(async () => { n++; throw err; }, o)).rejects.toBe(err);
      expect(n).toBe(1);
    }
  });
  it('quota court : on attend ; quota long de Gemini : modèle suivant', async () => {
    let t = setup(['a']), n = 0;
    expect(await withRetry(async () => { if (++n === 1) throw new RateLimitError(5); return 'ok'; }, t.o)).toBe('ok');
    expect(t.sleeps).toEqual([5000]);
    t = setup(['a', 'b']);
    expect(await withRetry(async (m) => { if (m === 'a') throw new RateLimitError(60); return m; }, t.o)).toBe('b');
    expect(t.sleeps).toEqual([]);
  });
  it('réseau coupé : un seul nouvel essai, puis erreur', async () => {
    const { o } = setup(['a', 'b']);
    let n = 0;
    await expect(withRetry(async () => { n++; throw new NetworkError(); }, o)).rejects.toBeInstanceOf(NetworkError);
    expect(n).toBe(2);
  });
});
