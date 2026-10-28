import { describe, expect, it, vi } from 'vitest';
import { GithubRepo } from '../src/lib/github/repo';
import { AuthError, ConflictError, NetworkError, NotFoundError } from '../src/lib/errors';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const repoWith = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
  const f = vi.fn(impl);
  return { repo: new GithubRepo('moi', 'Fiches', 'tok', f as unknown as typeof fetch), f };
};
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

describe('GithubRepo.writeFile', () => {
  it("encode les accents et symboles en UTF-8 avant le base64 (« Continuité ∀ε »)", async () => {
    const { repo, f } = repoWith(async () => json({ content: { sha: 'nouveau' } }));
    const r = await repo.writeFile('corpus/json/maths/x.json', 'Continuité ∀ε', { message: 'm' });
    const body = JSON.parse(String(f.mock.calls[0][1]?.body));
    expect(unb64(body.content)).toBe('Continuité ∀ε');
    expect(body.sha).toBeUndefined();
    expect(body.message).toBe('m');
    expect(f.mock.calls[0][1]?.method).toBe('PUT');
    expect(r.sha).toBe('nouveau');
  });
  it('envoie le sha pour une mise à jour', async () => {
    const { repo, f } = repoWith(async () => json({ content: { sha: 's2' } }));
    await repo.writeFile('a.json', 'x', { message: 'm', sha: 's1' });
    expect(JSON.parse(String(f.mock.calls[0][1]?.body)).sha).toBe('s1');
  });
  it('409 et 422 donnent ConflictError', async () => {
    for (const status of [409, 422]) {
      const { repo } = repoWith(async () => json({ message: 'conflit' }, status));
      await expect(repo.writeFile('a.json', 'x', { message: 'm', sha: 'vieux' })).rejects.toBeInstanceOf(ConflictError);
    }
  });
  it('401 donne AuthError', async () => {
    const { repo } = repoWith(async () => json({ message: 'Bad credentials' }, 401));
    await expect(repo.writeFile('a.json', 'x', { message: 'm' })).rejects.toBeInstanceOf(AuthError);
  });
});

describe('GithubRepo.readFile', () => {
  it('décode le base64 UTF-8 (retours à la ligne inclus) et renvoie le sha', async () => {
    const enc = b64('Continuité ∀ε');
    const { repo, f } = repoWith(async () => json({ content: `${enc.slice(0, 8)}\n${enc.slice(8)}\n`, encoding: 'base64', sha: 'abc' }));
    const r = await repo.readFile('x.md');
    expect(r).toEqual({ content: 'Continuité ∀ε', sha: 'abc' });
    expect(String(f.mock.calls[0][0])).toContain('/repos/moi/Fiches/contents/x.md');
  });
  it('404 donne NotFoundError', async () => {
    const { repo } = repoWith(async () => json({ message: 'Not Found' }, 404));
    await expect(repo.readFile('absent.md')).rejects.toBeInstanceOf(NotFoundError);
  });
  it('encode chaque segment du chemin sans toucher aux /', async () => {
    const { repo, f } = repoWith(async () => json({ content: b64('x'), sha: 's' }));
    await repo.readFile('corpus/cours/maths/dénombrement.md');
    expect(String(f.mock.calls[0][0])).toContain('/contents/corpus/cours/maths/d%C3%A9nombrement.md');
  });
});

describe('GithubRepo.listTree et requêtes', () => {
  it("fait un seul appel (arbre récursif) et renvoie path, type, sha", async () => {
    const { repo, f } = repoWith(async () => json({ tree: [{ path: 'a/b.json', type: 'blob', sha: '1', size: 3 }, { path: 'a', type: 'tree', sha: '2' }] }));
    const t = await repo.listTree();
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain('/git/trees/HEAD?recursive=1');
    expect(t).toEqual([{ path: 'a/b.json', type: 'blob', sha: '1' }, { path: 'a', type: 'tree', sha: '2' }]);
  });
  it("chaque requête porte l'en-tête Authorization", async () => {
    const { repo, f } = repoWith(async () => json({ tree: [] }));
    await repo.listTree();
    const h = new Headers(f.mock.calls[0][1]?.headers);
    expect(h.get('Authorization')).toBe('Bearer tok');
  });
  it('readBinary demande le contenu brut', async () => {
    const { repo, f } = repoWith(async () => new Response(new Uint8Array([1, 2, 3])));
    const buf = await repo.readBinary('fonts/x.ttf');
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
    expect(new Headers(f.mock.calls[0][1]?.headers).get('Accept')).toBe('application/vnd.github.raw+json');
  });
  it('un échec réseau donne NetworkError', async () => {
    const { repo } = repoWith(async () => { throw new TypeError('Failed to fetch'); });
    await expect(repo.listTree()).rejects.toBeInstanceOf(NetworkError);
  });
});
