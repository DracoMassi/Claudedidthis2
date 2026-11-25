import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissJob, finishJob, getJob, isActive, isRunning, resetJobs, startJob, subscribeJobs, updateJob } from '../src/lib/jobs/store';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); resetJobs(); });
afterEach(() => { vi.useRealTimers(); resetJobs(); });

describe('store des tâches', () => {
  it('démarrage, « depuis » qui repart quand le message ou l\'étape change, abonnés prévenus', () => {
    const f = vi.fn();
    const off = subscribeJobs(f);
    updateJob('generate', { step: 3 }); // tâche inexistante : rien
    expect(f).not.toHaveBeenCalled();
    startJob('generate', { title: 'Rolle', steps: 4, message: 'a' });
    expect(getJob('generate')).toMatchObject({ state: 'running', step: 0, steps: 4, title: 'Rolle' });
    vi.setSystemTime(1_005_000);
    updateJob('generate', { message: 'a' });
    expect(getJob('generate')?.since).toBe(1_000_000);
    updateJob('generate', { message: 'b' });
    expect(getJob('generate')?.since).toBe(1_005_000);
    vi.setSystemTime(1_007_000);
    updateJob('generate', { step: 2 });
    expect(getJob('generate')).toMatchObject({ since: 1_007_000, startedAt: 1_000_000 });
    expect(f).toHaveBeenCalledTimes(4);
    off();
    expect(isRunning('generate') && !isRunning('cours')).toBe(true);
  });
  it('attente de reprise, fin avec verdict et problèmes, fermeture', () => {
    startJob('cours', { title: 't', steps: 2, message: 'm' });
    updateJob('cours', { state: 'waiting', resumeAt: 5 });
    expect([isActive('cours'), isRunning('cours'), getJob('cours')?.resumeAt]).toEqual([true, false, 5]);
    updateJob('cours', { state: 'running' });
    expect(getJob('cours')?.resumeAt).toBeUndefined();
    finishJob('cours', { state: 'done', outcome: 'warn', message: 'fini', problems: [{ code: 'json', message: 'x' }] });
    expect(getJob('cours')).toMatchObject({ state: 'done', outcome: 'warn', message: 'fini', problems: [{ code: 'json', message: 'x' }] });
    expect(isActive('cours')).toBe(false);
    dismissJob('cours');
    expect(getJob('cours')?.dismissed).toBe(true);
  });
});
