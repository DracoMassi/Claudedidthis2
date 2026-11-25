import { contrastRatio } from '../../theme/contrast';

/** Les trois couleurs de la charte des fiches : titres, sous-titres et textes d'alerte, logo. Le fond reste blanc et le texte noir. */
export type FichePalette = { titre: string; sousTitre: string; logo: string };
export type FicheCouleurs = { preset: string; custom: FichePalette };

export const PRESETS: { id: string; label: string; palette: FichePalette }[] = [
  { id: 'sequentia', label: 'Séquentia (rouge)', palette: { titre: '#DD0033', sousTitre: '#B10029', logo: '#CB8593' } },
  { id: 'ocean', label: 'Océan', palette: { titre: '#0A66C2', sousTitre: '#084A8F', logo: '#7FA8D1' } },
  { id: 'foret', label: 'Forêt', palette: { titre: '#1F8A4C', sousTitre: '#16663A', logo: '#7DB896' } },
  { id: 'violet', label: 'Violet', palette: { titre: '#7B3FE4', sousTitre: '#5B2BB0', logo: '#A68BD6' } },
  { id: 'orange', label: 'Orange', palette: { titre: '#D9480F', sousTitre: '#A63A0B', logo: '#E0A178' } },
  { id: 'encre', label: 'Encre (noir et gris)', palette: { titre: '#1A1A1A', sousTitre: '#000000', logo: '#8A8A8A' } },
];
export const DEFAULT_PALETTE: FichePalette = PRESETS[0].palette;
export const DEFAULT_COULEURS: FicheCouleurs = { preset: 'sequentia', custom: DEFAULT_PALETTE };

/** « #abc » ou « abcdef » deviennent « #AABBCC » ; null si ce n'est pas une couleur hexadécimale. */
export function normalizeHex(v: unknown): string | null {
  const m = typeof v === 'string' ? /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim()) : null;
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toUpperCase()}`;
}

/** Palette effective d'après le réglage ; toute valeur invalide retombe sur la charte Séquentia. */
export function resolvePalette(c?: Partial<FicheCouleurs>): FichePalette {
  const preset = PRESETS.find((p) => p.id === c?.preset);
  if (preset) return preset.palette;
  if (c?.preset === 'perso') {
    const x = c.custom as Partial<FichePalette> | undefined;
    return { titre: normalizeHex(x?.titre) ?? DEFAULT_PALETTE.titre, sousTitre: normalizeHex(x?.sousTitre) ?? DEFAULT_PALETTE.sousTitre, logo: normalizeHex(x?.logo) ?? DEFAULT_PALETTE.logo };
  }
  return DEFAULT_PALETTE;
}

/** Pose les couleurs sur la racine d'une fiche ; elles descendent sur toutes les pages (aperçu, impression, export PNG et PDF). */
export function applyPalette(root: HTMLElement, p: FichePalette): void {
  root.style.setProperty('--f-rouge', p.titre);
  root.style.setProperty('--f-rouge-fonce', p.sousTitre);
  root.style.setProperty('--f-rose', p.logo);
}

/** Avertit quand les titres seraient peu lisibles sur le fond blanc (3:1 pour du grand texte). */
export function paletteWarnings(p: FichePalette): string[] {
  const out: string[] = [];
  for (const [nom, hex] of [['Les titres', p.titre], ['Les sous-titres et les pièges', p.sousTitre]] as const) {
    const r = contrastRatio(hex, '#FFFFFF');
    if (r < 3) out.push(`${nom} seraient peu lisibles sur fond blanc (contraste ${r.toFixed(1).replace('.', ',')}, 3 minimum). Choisis une couleur plus foncée.`);
  }
  return out;
}
