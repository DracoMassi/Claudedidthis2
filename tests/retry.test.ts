import { describe, expect, it } from 'vitest';
import { withRetry } from '../src/lib/gemini/retry';
import { AuthError, NetworkError, RateLimitError, ServerBusyError } from '../src/lib/errors';

function setup(models: string[], extra: Record<string, unknown> = {}) {
  const sleeps: number[] = [];
  const events: string[] = [];
  const o = { models, sleep: async (ms: number) => { sleeps.push(ms); }, random: () => 0, log: () => {}, onEvent: (e: { message: string }) => events.push(e.message), ...extra };
  return { sleeps, events, o };
}

describe('withRetry', () => {
  it('529 deux fois puis succès : attentes de 1 s puis 2 s', async () => {
    const { sleeps, o } = setup(['a']);
    let n = 0;
    const r = await withRetry(async () => { if (++n < 3) throw new ServerBusyError(529); return 'ok'; }, o);
    expect(r).toBe('ok');
    expect(n).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });
  it('quatre échecs sur le principal : bascule sur le modèle de secours', async () => {
    const { sleeps, events, o } = setup(['a', 'b']);
    const calls: string[] = [];
    const r = await withRetry(async (m) => { calls.push(m); if (m === 'a') throw new ServerBusyError(529); return 'via-' + m; }, o);
    expect(r).toBe('via-b');
    expect(calls).toEqual(['a', 'a', 'a', 'a', 'b']);
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(events.some((m) => m.includes('bascule sur b'))).toBe(true);
  });
  it("si tout échoue, relance l'erreur du modèle principal, pas celle du secours", async () => {
    const { o } = setup(['a', 'b']);
    await expect(withRetry(async (m) => { throw new ServerBusyError(m === 'a' ? 529 : 503); }, o)).rejects.toMatchObject({ status: 529 });
  });
  it('un modèle de secours inexistant (404) ne masque pas la surcharge du principal', async () => {
    const { o } = setup(['a', 'b']);
    await expect(withRetry(async (m) => { throw m === 'a' ? new ServerBusyError(529) : new NetworkError('Gemini a répondu 404'); }, o)).rejects.toMatchObject({ status: 529 });
  });
  it('clé refusée : arrêt immédiat, sans secours', async () => {
    const { o } = setup(['a', 'b']);
    let n = 0;
    await expect(withRetry(async () => { n++; throw new AuthError(); }, o)).rejects.toBeInstanceOf(AuthError);
    expect(n).toBe(1);
  });
  it('quota court : attend le délai indiqué puis réessaie', async () => {
    const { sleeps, o } = setup(['a']);
    let n = 0;
    expect(await withRetry(async () => { if (++n === 1) throw new RateLimitError(5); return 'ok'; }, o)).toBe('ok');
    expect(sleeps).toEqual([5000]);
  });
  it('quota long de Gemini : passe au modèle suivant (le quota est par modèle)', async () => {
    const { sleeps, o } = setup(['a', 'b']);
    const r = await withRetry(async (m) => { if (m === 'a') throw new RateLimitError(60); return 'ok-' + m; }, o);
    expect(r).toBe('ok-b');
    expect(sleeps).toEqual([]);
  });
  it('plafond local long : arrêt immédiat, le secours ne servirait à rien', async () => {
    const { o } = setup(['a', 'b']);
    const calls: string[] = [];
    await expect(withRetry(async (m) => { calls.push(m); throw new RateLimitError(60, true); }, o)).rejects.toMatchObject({ local: true });
    expect(calls).toEqual(['a']);
  });
  it('réseau coupé : un seul nouvel essai, puis erreur', async () => {
    const { o } = setup(['a', 'b']);
    let n = 0;
    await expect(withRetry(async () => { n++; throw new NetworkError(); }, o)).rejects.toBeInstanceOf(NetworkError);
    expect(n).toBe(2);
  });
  it('erreur inconnue : relancée telle quelle, sans reprise', async () => {
    const { o } = setup(['a']);
    let n = 0;
    await expect(withRetry(async () => { n++; throw new Error('boum'); }, o)).rejects.toThrow('boum');
    expect(n).toBe(1);
  });
  it('sans modèle : erreur explicite', async () => {
    await expect(withRetry(async () => 1, { models: [] })).rejects.toThrow('Aucun modèle');
  });
});
