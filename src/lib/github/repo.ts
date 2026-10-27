import { AuthError, ConflictError, NetworkError, NotFoundError } from '../errors';

export type TreeEntry = { path: string; type: 'blob' | 'tree'; sha: string };

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export class GithubRepo {
  private owner: string;
  private name: string;
  private token: string;
  private fetchImpl: typeof fetch;
  constructor(owner: string, name: string, token: string, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    this.owner = owner; this.name = name; this.token = token; this.fetchImpl = fetchImpl;
  }

  private async request(path: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<Response> {
    let r: Response;
    try {
      r = await this.fetchImpl(`https://api.github.com/repos/${this.owner}/${this.name}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' },
      });
    } catch {
      throw new NetworkError();
    }
    if (r.status === 401 || r.status === 403) throw new AuthError('Jeton refusé ou expiré');
    if (r.status === 404) throw new NotFoundError();
    if (r.status === 409 || r.status === 422) throw new ConflictError();
    if (!r.ok) throw new NetworkError(`GitHub a répondu ${r.status}`);
    return r;
  }

  async listTree(): Promise<TreeEntry[]> {
    const j = (await (await this.request('/git/trees/HEAD?recursive=1')).json()) as { tree: TreeEntry[] };
    return j.tree.map(({ path, type, sha }) => ({ path, type, sha }));
  }

  async readFile(path: string): Promise<{ content: string; sha: string }> {
    const j = (await (await this.request(`/contents/${encodePath(path)}`)).json()) as { content: string; sha: string };
    return { content: fromBase64(j.content), sha: j.sha };
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    return (await this.request(`/contents/${encodePath(path)}`, {}, 'application/vnd.github.raw+json')).arrayBuffer();
  }

  async writeFile(path: string, content: string, opts: { message: string; sha?: string }): Promise<{ sha: string }> {
    const body: Record<string, string> = { message: opts.message, content: toBase64(content) };
    if (opts.sha) body.sha = opts.sha;
    const j = (await (await this.request(`/contents/${encodePath(path)}`, { method: 'PUT', body: JSON.stringify(body) })).json()) as { content: { sha: string } };
    return { sha: j.content.sha };
  }
}
