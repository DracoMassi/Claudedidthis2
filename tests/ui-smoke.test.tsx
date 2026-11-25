import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_REFS, mergeRef, refFromFiche, type RefSet } from '../src/lib/generate/refs';
import { finishJob, resetJobs, startJob, updateJob } from '../src/lib/jobs/store';
import { getSettings, saveSettings } from '../src/lib/storage/settings';
import { openDb } from '../src/lib/storage/db';
import type { Fiche } from '../src/lib/types';
import BlockPicker from '../src/ui/BlockPicker';
import Generate from '../src/ui/Generate';
import JobBar from '../src/ui/JobBar';
import Settings from '../src/ui/Settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fiche: Fiche = { schema_version: '1.1', meta: { titre: 'Continuité', matiere: 'maths', niveau: 'mpsi', chapitre: 'C', statut: 'verifie' },
  pages: [{ titre_page: 'Bases', blocks: [{ type: 'definition', terme: 'Continuité', enonce: 'x' }, { type: 'theoreme', nom: 'TVI', enonce: 'y' }] }] };

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { localStorage.clear(); resetJobs(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); resetJobs(); vi.restoreAllMocks(); });
const text = () => host.textContent ?? '';
const click = (el: Element | null | undefined) => act(() => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const buttonByText = (t: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(t));

describe('Réglages : bascule de modèle et couleurs des fiches', () => {
  it('Secours désactivé sans modèle puis bascule ; une palette de fiche se choisit et se réinitialise', () => {
    act(() => root.render(<Settings />));
    const radios = () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios()).toHaveLength(2);
    expect(radios()[1].disabled).toBe(true);
    saveSettings({ modelSecours: 'lite' });
    act(() => { window.dispatchEvent(new Event('sequentia-settings-changed')); });
    expect(radios()[1].disabled).toBe(false);
    click(radios()[1]);
    expect(radios()[1].getAttribute('aria-checked')).toBe('true');
    expect(radios()[0].getAttribute('aria-checked')).toBe('false');
    click(radios()[0]);
    expect(radios()[0].getAttribute('aria-checked')).toBe('true');
    click(buttonByText('Océan'));
    expect(getSettings().ficheCouleurs.preset).toBe('ocean');
    click(buttonByText('Personnalisé'));
    expect(host.querySelectorAll('input[type="color"]').length).toBeGreaterThanOrEqual(3);
    click(buttonByText('Revenir à la charte'));
    expect(getSettings().ficheCouleurs.preset).toBe('sequentia');
  });
});

describe('Générer : progression conservée et références', () => {
  const props = async (refs: RefSet = EMPTY_REFS, onRefsChange = vi.fn()) => ({ repo: null, db: await openDb(), onOpenDraft: vi.fn(), refs, onRefsChange, onGoLibrary: vi.fn() });

  it('progression et résultat relus au retour sur l\'onglet ; bandeau visible dans les autres onglets', async () => {
    startJob('generate', { title: 'TVI', steps: 4, message: 'Tour 2 sur 4 : envoi à Gemini (m)…' });
    updateJob('generate', { step: 2 });
    const p = await props();
    act(() => root.render(<Generate {...p} />));
    expect(text()).toContain('Tour 2 sur 4 : envoi à Gemini (m)…');
    expect(buttonByText('Génération en cours…')?.disabled).toBe(true);
    expect(renderToStaticMarkup(<JobBar entree="Réglages" onGo={() => undefined} />)).toContain('Fiche : TVI');
    expect(renderToStaticMarkup(<JobBar entree="Générer" onGo={() => undefined} />)).toBe('');
    act(() => finishJob('generate', { state: 'done', outcome: 'ok', message: 'Brouillon prêt après 2 tours' }));
    expect(text()).toContain('Brouillon prêt après 2 tours');
    click(buttonByText('Fermer'));
    expect(text()).not.toContain('Brouillon prêt après 2 tours');
  });

  it('affiche les références, permet de retirer un bloc et de changer de mode', async () => {
    const refs = mergeRef(EMPTY_REFS, refFromFiche(fiche, 'f'));
    const onRefsChange = vi.fn();
    const p = await props(refs, onRefsChange);
    act(() => root.render(<Generate {...p} />));
    expect(text()).toContain('Références de la bibliothèque');
    expect(text()).toContain('Continuité');
    expect(text()).toContain('2 blocs');
    click(host.querySelector('[aria-label="Retirer Théorème : TVI"]'));
    expect(onRefsChange).toHaveBeenCalledTimes(1);
    expect(onRefsChange.mock.calls[0][0].items[0].blocks).toHaveLength(1);
    const select = host.querySelector<HTMLSelectElement>('select option[value="reprendre"]')!.parentElement as HTMLSelectElement;
    act(() => { select.value = 'reprendre'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onRefsChange.mock.calls.at(-1)?.[0].mode).toBe('reprendre');
  });

  it('colle du JSON de blocs pour les ajouter aux références', async () => {
    const onRefsChange = vi.fn();
    const p = await props(EMPTY_REFS, onRefsChange);
    act(() => root.render(<Generate {...p} />));
    const ta = [...host.querySelectorAll('textarea')].find((t) => t.id && host.querySelector(`label[for="${t.id}"]`)?.textContent === 'JSON')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => { setter.call(ta, JSON.stringify(fiche.pages[0].blocks)); ta.dispatchEvent(new Event('input', { bubbles: true })); });
    click(buttonByText('Ajouter aux références'));
    expect(onRefsChange).toHaveBeenCalledTimes(1);
    expect(onRefsChange.mock.calls[0][0].items[0].blocks).toHaveLength(2);
    expect(text()).toContain('2 blocs ajoutés aux références');
  });
});

describe('BlockPicker : de la bibliothèque vers Générer', () => {
  it('envoie seulement les blocs cochés, ou toute la fiche', () => {
    const onSend = vi.fn();
    act(() => root.render(<BlockPicker fiche={fiche} path="corpus/json/maths/c.json" onSend={onSend} />));
    expect(buttonByText('Envoyer la sélection (0)')?.disabled).toBe(true);
    click(host.querySelectorAll('input[type="checkbox"]')[1]);
    expect(buttonByText('Envoyer la sélection (1)')?.disabled).toBe(false);
    click(buttonByText('Envoyer la sélection (1)'));
    expect(onSend.mock.calls[0][0].blocks.map((b: { block: { nom?: string } }) => b.block.nom)).toEqual(['TVI']);
    click(buttonByText('Envoyer toute la fiche (2)'));
    expect(onSend.mock.calls[1][0].blocks).toHaveLength(2);
    expect(onSend.mock.calls[1][0].path).toBe('corpus/json/maths/c.json');
  });
});
