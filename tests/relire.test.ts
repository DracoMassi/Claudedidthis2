import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { canValidate, parseChecklist } from '../src/lib/relire/checklist';
import { correctFiche, slugify, validerFiche } from '../src/lib/relire/valider';
import { ConflictError, NotFoundError } from '../src/lib/errors';
import type { GenerateDeps } from '../src/lib/generate/loop';
import type { Fiche } from '../src/lib/types';

const v10: Fiche = JSON.parse(readFileSync('tests/fixtures/fiche-v10.json', 'utf8'));

describe('parseChecklist', () => {
  it('lit les puces sous « ## Checklist de relecture » jusqu’au titre suivant', () => {
    const md = '# Charte\n## Ton\n- ignoré\n## Checklist de relecture\n- Hypothèses vérifiées\n* Notations\n\n## Autre\n- ignoré aussi';
    expect(parseChecklist(md)).toEqual(['Hypothèses vérifiées', 'Notations']);
  });
  it('renvoie les trois éléments par défaut sans cette section', () => {
    expect(parseChecklist('# Charte sans checklist')).toEqual(['Hypothèses explicites (intervalle, a ≤ b)', 'Quantificateurs corrects', 'Notations et macros de la charte']);
    expect(parseChecklist('')).toHaveLength(3);
  });
});

describe('canValidate', () => {
  it('exige que toutes les cases soient cochées, et au moins une case', () => {
    expect(canValidate([true, true, false])).toBe(false);
    expect(canValidate([])).toBe(false);
    expect(canValidate([true, true, true])).toBe(true);
  });
});

describe('slugify (réexporté)', () => {
  it('vaut celui de lib/slug', () => expect(slugify('Théorème des valeurs intermédiaires')).toBe('theoreme-des-valeurs-intermediaires'));
});

describe('validerFiche', () => {
  const mk = (writeImpl = async () => ({ sha: 'n' })) => ({
    writeFile: vi.fn(writeImpl),
    readFile: vi.fn(async () => ({ content: '{}', sha: 'sha-distant' })),
  });
  it('écrit corpus/json/<matiere>/<slug>.json avec statut verifie et renvoie le chemin', async () => {
    const repo = mk();
    const path = await validerFiche(repo, { ...v10, meta: { ...v10.meta, titre: 'Théorème des valeurs intermédiaires', statut: 'a_verifier' } });
    expect(path).toBe('corpus/json/maths/theoreme-des-valeurs-intermediaires.json');
    const [p, content, opts] = repo.writeFile.mock.calls[0] as unknown as [string, string, { sha?: string; message: string }];
    expect(p).toBe(path);
    expect(JSON.parse(content).meta.statut).toBe('verifie');
    expect(opts.sha).toBeUndefined();
  });
  it('utilise le sha lu à l’ouverture pour une fiche existante', async () => {
    const repo = mk();
    await validerFiche(repo, v10, { baseSha: 'sha-ouverture' });
    expect((repo.writeFile.mock.calls[0] as unknown as [string, string, { sha?: string }])[2].sha).toBe('sha-ouverture');
  });
  it('propage ConflictError sans écrire ailleurs ni écraser', async () => {
    const repo = mk(async () => { throw new ConflictError(); });
    await expect(validerFiche(repo, v10, { baseSha: 'vieux' })).rejects.toBeInstanceOf(ConflictError);
    expect(repo.writeFile).toHaveBeenCalledTimes(1);
  });
  it('« écraser » relit le sha distant puis écrit avec ce sha', async () => {
    const repo = mk();
    await validerFiche(repo, v10, { baseSha: 'vieux', force: true });
    expect((repo.writeFile.mock.calls[0] as unknown as [string, string, { sha?: string }])[2].sha).toBe('sha-distant');
  });
  it('« écraser » sur un fichier devenu absent écrit sans sha', async () => {
    const repo = mk();
    repo.readFile.mockRejectedValueOnce(new NotFoundError());
    await validerFiche(repo, v10, { baseSha: 'vieux', force: true });
    expect((repo.writeFile.mock.calls[0] as unknown as [string, string, { sha?: string }])[2].sha).toBeUndefined();
  });
});

describe('correctFiche', () => {
  it("ajoute la fiche actuelle et l'instruction au message utilisateur envoyé au modèle", async () => {
    const llm = vi.fn(async () => JSON.stringify(v10));
    const deps: GenerateDeps = { llm, validate: () => [], lint: () => [], render: () => ({ katexErrors: [], overflow: [] }) };
    const r = await correctFiche(v10, 'découpe la page 3', { system: 's', user: 'BRIEF…' }, deps);
    expect(r.ok).toBe(true);
    const first = (llm.mock.calls[0][0] as { role: string; text: string }[])[0];
    expect(first.role).toBe('user');
    expect(first.text).toContain('BRIEF…');
    expect(first.text).toContain('découpe la page 3');
    expect(first.text).toContain(v10.meta.titre);
  });
});
