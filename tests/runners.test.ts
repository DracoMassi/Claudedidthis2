import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportQueue } from '../src/lib/cours/queue';
import { EMPTY_REFS, refFromFiche, mergeRef } from '../src/lib/generate/refs';
import { getJob, resetJobs, startJob, subscribeJobs } from '../src/lib/jobs/store';
import { NotFoundError } from '../src/lib/errors';
import { openDb, type Db } from '../src/lib/storage/db';
import { saveSettings } from '../src/lib/storage/settings';
import type { Fiche } from '../src/lib/types';
import { runGenerate } from '../src/ui/runGenerate';
import { cancelAuto, resumeNow, startCoursRun } from '../src/ui/runCours';

const reply = (text: string) => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] }), { status: 200 });
/** Réponse de transcription cohérente avec le lot demandé : un repère par page. */
const transcription = (init?: RequestInit) => {
  const t = String(init?.body ?? '');
  const m = /pages de (\d+) à (\d+)/.exec(t);
  const [a, b] = m ? [Number(m[1]), Number(m[2])] : [1, 1];
  return reply(Array.from({ length: b - a + 1 }, (_, k) => `<!-- page ${a + k} -->\nTexte de cours suffisamment long.`).join('\n\n'));
};
const lot = (i: number) => ({ index: i, fromPage: i + 1, toPage: i + 1, data: new Uint8Array([i, 1]), mime: 'image/png' });

let db: Db;
const seen: string[] = [];
let off: () => void;
beforeEach(async () => {
  localStorage.clear();
  resetJobs();
  db = await openDb();
  saveSettings({ geminiKey: 'K', model: 'principal-m', modelSecours: '', modeleActif: 'principal', maxPerMinute: 100, maxPerDay: 1000 });
  seen.length = 0;
  off = subscribeJobs(() => { const j = getJob('cours') ?? getJob('generate'); if (j) seen.push(j.message); });
});
afterEach(() => { off(); vi.unstubAllGlobals(); vi.useRealTimers(); cancelAuto(); resetJobs(); });

describe('startCoursRun : la tâche vit hors du composant', () => {
  const enqueue = async (n = 2) => { await new ImportQueue(db, async () => '').enqueue('imp', Array.from({ length: n }, (_, i) => lot(i))); };

  it('publie la progression lot par lot, utilise le modèle choisi par la bascule, refuse un deuxième lancement', async () => {
    await enqueue();
    saveSettings({ modelSecours: 'secours-m', modeleActif: 'secours' });
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => { urls.push(u); return transcription(init); }));
    startJob('cours', { title: 'autre', steps: 1, message: 'm' });
    expect(await startCoursRun(db, 'imp', 'T')).toBe(false); // une tâche tourne déjà
    resetJobs();
    expect(await startCoursRun(db, 'imp', 'Optique')).toBe(true);
    expect(getJob('cours')).toMatchObject({ state: 'done', outcome: 'ok', steps: 2, step: 2, title: 'Optique', ref: 'imp' });
    expect(urls[0]).toContain('/models/secours-m:');
    expect(seen).toContain('Lot 1 sur 2 : transcription par Gemini (secours-m)…');
    expect(seen).toContain('Lot 2 sur 2 transcrit et vérifié');
  });

  it('réseau coupé : attente avec compte à rebours, annulable ; « Reprendre maintenant » termine', async () => {
    await enqueue();
    vi.useFakeTimers();
    let up = false;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => { if (!up) throw new TypeError('Failed to fetch'); return transcription(init); }));
    const p = startCoursRun(db, 'imp', 'T');
    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(getJob('cours')).toMatchObject({ state: 'waiting' });
    expect(getJob('cours')?.resumeAt).toBeGreaterThan(Date.now());
    expect(getJob('cours')?.message).toContain('Nouvel essai automatique (1/3)');
    cancelAuto();
    expect(getJob('cours')).toMatchObject({ state: 'error', outcome: 'warn' });
    expect(await new ImportQueue(db, async () => '').progress('imp')).toEqual({ done: 0, total: 2 });
    const q = startCoursRun(db, 'imp', 'T');
    await vi.advanceTimersByTimeAsync(1500);
    await q;
    up = true;
    resumeNow();
    await vi.waitFor(() => expect(getJob('cours')?.state).toBe('done'));
  });
});

describe('runGenerate : la génération vit hors du composant', () => {
  const repo = { listTree: vi.fn(async () => []), readFile: vi.fn(async () => { throw new NotFoundError(); }) } as never;
  const brief = { id: 'b', matiere: 'maths', niveau: 'mpsi', chapitre: 'C', sujet: 'TVI' };
  const fiche: Fiche = { schema_version: '1.1', meta: { titre: 'Source', matiere: 'maths', niveau: 'mpsi', chapitre: 'C', statut: 'verifie' }, pages: [{ blocks: [{ type: 'theoreme', nom: 'Rolle', enonce: 'Soit f…' }] }] };

  it('4 tours sans JSON valide : brouillon gardé, verdict « warn », phases publiées, références envoyées à Gemini', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => { bodies.push(String(init?.body)); return reply('ceci n’est pas du JSON'); }));
    const refs = mergeRef({ ...EMPTY_REFS, mode: 'reprendre' }, refFromFiche(fiche, 'corpus/json/maths/s.json'));
    expect(await runGenerate({ repo, db, brief, refs })).toBe(true);
    expect(getJob('generate')).toMatchObject({ state: 'done', outcome: 'warn', step: 4, steps: 4, ref: 'b' });
    expect(getJob('generate')?.problems?.[0].code).toBe('json');
    expect(bodies).toHaveLength(4);
    expect(bodies[0]).toContain('BLOCS À REPRENDRE');
    expect(bodies[0]).toContain('Rolle');
    expect(seen).toContain('Tour 1 sur 4 : envoi à Gemini (principal-m)…');
    expect(seen).toContain('Tour 4 sur 4 : réponse reçue, lecture du JSON…');
    expect((await db.getDraft('b'))?.problems.length).toBeGreaterThan(0);
  });

  it('dépôt illisible : erreur sans appel à Gemini ; une génération déjà en cours bloque la suivante', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await runGenerate({ repo: { listTree: vi.fn(async () => { throw new TypeError('x'); }), readFile: vi.fn() } as never, db, brief });
    expect(getJob('generate')).toMatchObject({ state: 'error', outcome: 'error' });
    expect(f).not.toHaveBeenCalled();
    startJob('generate', { title: 'autre', steps: 4, message: 'm' });
    expect(await runGenerate({ repo, db, brief })).toBe(false);
  });
});
