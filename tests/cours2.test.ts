import { describe, expect, it, vi } from 'vitest';
import { renderMarkdownPreview } from '../src/lib/cours/preview';
import { saveCours, coursPath } from '../src/lib/cours/save';
import { ImportQueue } from '../src/lib/cours/queue';
import { openDb } from '../src/lib/storage/db';
import { ConflictError } from '../src/lib/errors';

describe('renderMarkdownPreview', () => {
  const rend = (md: string) => { const root = document.createElement('div'); const r = renderMarkdownPreview(root, md); return { root, ...r }; };
  it('rend titres, citations, listes, repères de page et formules ; ignore le front matter', () => {
    const { root, katexErrors } = rend('---\nstatut: a_verifier\n---\n# Titre\n## Sec\n> **Définition.** Soit $f$\n- a\n- b\n<!-- page 2 -->\ntexte $\\R$');
    expect(katexErrors).toEqual([]);
    expect(root.querySelector('h1')?.textContent).toBe('Titre');
    expect(root.querySelector('h2')?.textContent).toBe('Sec');
    expect(root.querySelector('blockquote .katex')).not.toBeNull();
    expect(root.querySelectorAll('ul li')).toHaveLength(2);
    expect(root.querySelector('.page-marker')?.textContent).toBe('Page 2');
    expect(root.textContent).not.toContain('statut');
  });
  it('insère le HTML comme texte et remonte les erreurs KaTeX', () => {
    const { root, katexErrors } = rend('# T\n<script>alert(1)</script> $\\inconnue$');
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain('<script>alert(1)</script>');
    expect(katexErrors).toHaveLength(1);
  });
});

describe('saveCours', () => {
  const meta = { matiere: 'maths', niveau: 'mpsi', chapitre: 'Continuité', source: 'c.pdf', statut: 'a_verifier' as const };
  const mk = (impl = async () => ({ sha: 'n' })) => ({ writeFile: vi.fn(impl), readFile: vi.fn(async () => ({ content: '', sha: 'distant' })) });
  it('coursPath', () => expect(coursPath(meta)).toBe('corpus/cours/maths/continuite.md'));
  it('écrit le cours avec son front matter', async () => {
    const repo = mk();
    const p = await saveCours(repo, meta, '# Continuité');
    expect(p).toBe('corpus/cours/maths/continuite.md');
    const [path, content, opts] = repo.writeFile.mock.calls[0] as unknown as [string, string, { sha?: string }];
    expect(path).toBe(p);
    expect(content).toContain('statut: a_verifier');
    expect(opts.sha).toBeUndefined();
  });
  it('un cours existant donne ConflictError sans écraser ; écraser relit le sha', async () => {
    const refus = mk(async () => { throw new ConflictError(); });
    await expect(saveCours(refus, meta, 'x')).rejects.toBeInstanceOf(ConflictError);
    const ok = mk();
    await saveCours(ok, meta, 'x', { force: true });
    expect((ok.writeFile.mock.calls[0] as unknown as [string, string, { sha?: string }])[2].sha).toBe('distant');
  });
});

describe('ImportQueue.lots', () => {
  it('relit les lots enregistrés, données comprises', async () => {
    const q = new ImportQueue(await openDb(), async () => 'x');
    await q.enqueue('i', [{ index: 0, fromPage: 1, toPage: 5, data: new Uint8Array([9, 8, 7]), mime: 'image/png' }]);
    const l = await q.lots('i');
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ index: 0, fromPage: 1, toPage: 5, mime: 'image/png' });
    expect([...l[0].data]).toEqual([9, 8, 7]);
  });
});
