import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE, PRESETS, applyPalette, normalizeHex, paletteWarnings, resolvePalette } from '../src/lib/render/palette';
import { renderFiche } from '../src/lib/render/renderFiche';
import type { Fiche } from '../src/lib/types';

const fiche: Fiche = { schema_version: '1.1', meta: { titre: 'T', matiere: 'maths', niveau: 'mpsi', chapitre: 'C', statut: 'verifie' }, pages: [{ blocks: [] }] };

describe('couleurs des fiches', () => {
  it('hexadécimal normalisé, palette résolue avec repli sur la charte, alerte de contraste', () => {
    expect(normalizeHex('abc')).toBe('#AABBCC');
    expect(normalizeHex(' #0a66c2 ')).toBe('#0A66C2');
    expect(normalizeHex('rouge')).toBeNull();
    expect(resolvePalette(undefined)).toEqual(DEFAULT_PALETTE);
    expect(resolvePalette({ preset: 'ocean' })).toEqual(PRESETS[1].palette);
    expect(resolvePalette({ preset: 'perso', custom: { titre: '#123', sousTitre: 'nul', logo: '#ABCDEF' } })).toEqual({ titre: '#112233', sousTitre: DEFAULT_PALETTE.sousTitre, logo: '#ABCDEF' });
    expect(PRESETS.every((p) => paletteWarnings(p.palette).length === 0)).toBe(true);
    expect(paletteWarnings({ titre: '#FFFF99', sousTitre: '#000000', logo: '#FFFFFF' })).toHaveLength(1);
  });
  it('la fiche rendue porte les couleurs choisies (aperçu, impression et export héritent de la racine)', () => {
    const root = document.createElement('div');
    renderFiche(root, fiche, PRESETS[1].palette);
    expect(root.style.getPropertyValue('--f-rouge')).toBe('#0A66C2');
    expect(root.style.getPropertyValue('--f-rouge-fonce')).toBe('#084A8F');
    renderFiche(root, fiche);
    expect(root.style.getPropertyValue('--f-rouge')).toBe(DEFAULT_PALETTE.titre);
    applyPalette(root, PRESETS[2].palette);
    expect(root.style.getPropertyValue('--f-rose')).toBe('#7DB896');
  });
});
