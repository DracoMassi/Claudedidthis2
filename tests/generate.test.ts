import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { splitSections } from '../src/lib/generate/sections';
import { buildPrompt, pickCourseSections, pickExamples } from '../src/lib/generate/context';
import { generateFiche, type GenerateDeps } from '../src/lib/generate/loop';
import { RateLimitError } from '../src/lib/errors';
import type { Brief, Fiche } from '../src/lib/types';

const v10: Fiche = JSON.parse(readFileSync('tests/fixtures/fiche-v10.json', 'utf8'));
const brief: Brief = { id: 'b', matiere: 'maths', niveau: 'mpsi', chapitre: 'Continuité', sujet: 'théorème des valeurs intermédiaires' };
const fiche = (titre: string, extra: Partial<Fiche['meta']> = {}): Fiche => ({ ...v10, meta: { ...v10.meta, titre, ...extra } });

describe('splitSections', () => {
  it('découpe selon ## et ignore ce qui précède le premier titre', () => {
    const s = splitSections('# Titre\nintro\n## A\nun\n## B\ndeux');
    expect(s).toEqual([{ titre: 'A', texte: 'un' }, { titre: 'B', texte: 'deux' }]);
  });
});

describe('pickExamples', () => {
  const proche = fiche('Valeurs intermédiaires');
  const loin = fiche('Dénombrement');
  const exemple = fiche('Autre sujet', { exemple: true });
  it("place d'abord meta.exemple, puis la proximité de mots-clés, au plus k", () => {
    const r = pickExamples([loin, proche, exemple], brief, 2);
    expect(r.map((f) => f.meta.titre)).toEqual(['Autre sujet', 'Valeurs intermédiaires']);
  });
  it('ne garde que la même matière et renvoie [] sans exemple', () => {
    expect(pickExamples([fiche('X', { matiere: 'physique' })], brief)).toEqual([]);
    expect(pickExamples([], brief)).toEqual([]);
  });
});

describe('pickCourseSections', () => {
  it('place les cours verifie avant a_verifier, au plus 3 sections, sans hors-sujet', () => {
    const cours = [
      { md: '## TVI\nle théorème des valeurs intermédiaires version brouillon', statut: 'a_verifier' as const },
      { md: '## TVI\nle théorème des valeurs intermédiaires version validée\n## Autre\nrien', statut: 'verifie' as const },
      { md: '## Dérivée\nrien à voir', statut: 'verifie' as const },
    ];
    const r = pickCourseSections(cours, brief, 3);
    expect(r).toHaveLength(2);
    expect(r[0]).toContain('version validée');
    expect(r[1]).toContain('brouillon');
  });
});

describe('buildPrompt', () => {
  it('fonctionne sans exemple ni cours et contient la charte et le schéma', () => {
    const p = buildPrompt({ charte: 'CHARTE-XYZ', schema: { title: 'SCHEMA-ABC' }, examples: [], sections: [], brief });
    expect(p.system).toContain('CHARTE-XYZ');
    expect(p.system).toContain('SCHEMA-ABC');
    expect(p.system).toContain('mpsi');
    expect(p.user).toContain('"sujet"');
    expect(p.user).toContain('aucun exemple');
  });
});

describe('generateFiche', () => {
  const prompt = { system: 's', user: 'u' };
  const bon = JSON.stringify(v10);
  const deps = (llm: GenerateDeps['llm'], over: Partial<GenerateDeps> = {}): GenerateDeps => ({
    llm, validate: () => [], lint: () => [], render: () => ({ katexErrors: [], overflow: [] }), ...over,
  });

  it("s'arrête au tour 1 sans problème", async () => {
    const llm = vi.fn(async () => bon);
    const r = await generateFiche(brief, prompt, deps(llm));
    expect(r).toMatchObject({ ok: true, tours: 1 });
    expect(r.fiche?.meta.titre).toBe(v10.meta.titre);
    expect(llm).toHaveBeenCalledTimes(1);
  });
  it('renvoie le problème au tour suivant et réussit au tour 2', async () => {
    let n = 0;
    const llm = vi.fn(async () => bon);
    const validate = vi.fn(() => (++n === 1 ? [{ code: 'schema' as const, message: 'latex interdit ici', path: '/pages/0' }] : []));
    const r = await generateFiche(brief, prompt, deps(llm, { validate }));
    expect(r).toMatchObject({ ok: true, tours: 2 });
    const second = llm.mock.calls[1][0] as { role: string; text: string }[];
    expect(second.at(-1)?.role).toBe('user');
    expect(second.at(-1)?.text).toContain('latex interdit ici');
    expect(second.map((m) => m.role)).toEqual(['user', 'model', 'user']);
  });
  it('renvoie aussi les erreurs KaTeX et les débordements', async () => {
    let n = 0;
    const render = () => (++n === 1 ? { katexErrors: ['Undefined control sequence'], overflow: [2] } : { katexErrors: [], overflow: [] });
    const llm = vi.fn(async () => bon);
    await generateFiche(brief, prompt, deps(llm, { render }));
    const txt = (llm.mock.calls[1][0] as { text: string }[]).at(-1)!.text;
    expect(txt).toContain('Undefined control sequence');
    expect(txt).toContain('débordement page 2');
  });
  it('après 4 tours en échec : ok false, tours 4, dernier essai conservé', async () => {
    const llm = vi.fn(async () => '{"pas": "une fiche"');
    const r = await generateFiche(brief, prompt, deps(llm));
    expect(r.ok).toBe(false);
    expect(r.tours).toBe(4);
    expect(r.last).toBe('{"pas": "une fiche"');
    expect(r.problems[0].code).toBe('json');
    expect(llm).toHaveBeenCalledTimes(4);
  });
  it('un quota atteint (429) au tour 2 interrompt la boucle et conserve le dernier essai', async () => {
    let n = 0;
    const llm = vi.fn(async () => { if (++n === 2) throw new RateLimitError(12); return '{"x":1}'; });
    const validate = () => [{ code: 'schema' as const, message: 'invalide' }];
    const r = await generateFiche(brief, prompt, deps(llm, { validate }));
    expect(r.ok).toBe(false);
    expect(r.tours).toBe(1);
    expect(r.last).toBe('{"x":1}');
    expect(r.error).toBeInstanceOf(RateLimitError);
    expect(r.problems.length).toBeGreaterThan(0);
  });
});
