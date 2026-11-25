import { describe, expect, it, vi } from 'vitest';
import { diagnoseGithub, libraryMessage } from '../src/lib/github/diagnose';
import { AuthError, ConflictError, NetworkError, NotFoundError, RateLimitError } from '../src/lib/errors';
import { GithubRepo } from '../src/lib/github/repo';

const json = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const o = { owner: 'DracoMassi', repo: 'Fiches', token: 'tok' };
const api = (meta: Response, tree: Response) => vi.fn(async (u: string) => (String(u).endsWith('/git/trees/HEAD') ? tree : meta)) as unknown as typeof fetch;
const auth = (f: unknown) => ((f as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].headers;

describe('diagnostic GitHub', () => {
  it('connecté seulement si le dépôt ET son contenu sont lisibles', async () => {
    expect(await diagnoseGithub(o, api(json(200), json(200, { tree: [{ path: 'corpus' }] })))).toEqual({ ok: true, message: 'GitHub : connecté' });
  });
  it('chaque cause a son message : Contents, 404, 401, dépôt vide, limite, corpus absent', async () => {
    const cas: [Response, Response, string][] = [
      [json(200), json(403), 'Contents'], [json(404), json(404), 'Dépôt introuvable'], [json(401), json(401), '401'],
      [json(200), json(409), 'vide'], [json(403, {}, { 'x-ratelimit-remaining': '0' }), json(403), 'limite'],
      [json(200), json(200, { tree: [{ path: 'README.md' }] }), 'corpus/'],
    ];
    for (const [meta, tree, attendu] of cas) {
      const r = await diagnoseGithub(o, api(meta, tree));
      expect(r.ok).toBe(false);
      expect(r.message).toContain(attendu);
    }
  });
  it('réseau coupé, champs vides, espaces autour du jeton retirés', async () => {
    expect((await diagnoseGithub(o, vi.fn(async () => { throw new TypeError('x'); }) as unknown as typeof fetch)).message).toContain("n'a pas répondu");
    expect((await diagnoseGithub({ ...o, token: '' })).ok).toBe(false);
    const f = vi.fn(async () => json(200, { tree: [{ path: 'corpus' }] }));
    await diagnoseGithub({ ...o, token: '  tok\n' }, f as unknown as typeof fetch);
    expect(auth(f)).toMatchObject({ Authorization: 'Bearer tok' });
  });
  it('GithubRepo distingue 401, 403 et quota épuisé, et nettoie le jeton', async () => {
    const repo = (res: Response, token = 'tok') => new GithubRepo('o', 'r', token, vi.fn(async () => res) as unknown as typeof fetch);
    await expect(repo(json(401)).listTree()).rejects.toMatchObject({ name: 'AuthError', status: 401 });
    await expect(repo(json(403)).listTree()).rejects.toMatchObject({ name: 'AuthError', status: 403 });
    await expect(repo(json(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 120) })).listTree()).rejects.toBeInstanceOf(RateLimitError);
    const f = vi.fn(async () => json(200, { tree: [] }));
    await new GithubRepo('o', 'r', '  abc \n', f as unknown as typeof fetch).listTree();
    expect(auth(f)).toMatchObject({ Authorization: 'Bearer abc' });
  });
  it('libraryMessage : un message par cause', () => {
    expect(libraryMessage(new AuthError('x', 403))).toContain('Contents');
    expect(libraryMessage(new AuthError('x', 401))).toContain('401');
    expect(libraryMessage(new NotFoundError())).toContain('404');
    expect(libraryMessage(new ConflictError())).toContain('vide');
    expect(libraryMessage(new NetworkError())).toContain("n'a pas répondu");
    expect(libraryMessage(new Error('boum'))).toContain('boum');
  });
});
