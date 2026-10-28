import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { lintLatex } from '../src/lib/schema/lint';
import type { Fiche } from '../src/lib/types';

const base = (): Fiche => JSON.parse(readFileSync('tests/fixtures/fiche-v10.json', 'utf8'));
const withText = (t: string): Fiche => {
  const f = base();
  (f.pages[0].blocks[0] as { enonce: string }).enonce = t;
  return f;
};

describe('lintLatex', () => {
  it('ne signale rien sur une fiche propre (aligned autorisé)', () => {
    expect(lintLatex(base())).toEqual([]);
    expect(lintLatex(withText('$\\begin{aligned} a &= b \\end{aligned}$'))).toEqual([]);
  });
  for (const motif of ['\\usepackage{x}', '$\\begin{align} a \\end{align}$', '\\[ x \\]', '\\tikz', '$\\textbf{x}$']) {
    it(`signale ${motif}`, () => {
      const p = lintLatex(withText(motif));
      expect(p.length).toBeGreaterThan(0);
      expect(p[0].code).toBe('lint');
    });
  }
});
