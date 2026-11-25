import { useState } from 'react';
import { DEFAULT_COULEURS, PRESETS, paletteWarnings, resolvePalette, type FichePalette } from '../lib/render/palette';
import { getSettings, saveSettings } from '../lib/storage/settings';
import { Notice, Section } from './kit';

const CHAMPS: { key: keyof FichePalette; label: string }[] = [
  { key: 'titre', label: 'Titres' },
  { key: 'sousTitre', label: 'Sous-titres et pièges' },
  { key: 'logo', label: 'Logo' },
];
const bande = (p: FichePalette) => `linear-gradient(90deg, ${p.titre} 0 34%, ${p.sousTitre} 34% 67%, ${p.logo} 67% 100%)`;

export default function FichePaletteSettings() {
  const [c, setC] = useState(() => getSettings().ficheCouleurs);
  const update = (next: typeof c) => {
    saveSettings({ ficheCouleurs: next });
    setC(next);
    window.dispatchEvent(new Event('sequentia-settings-changed'));
  };
  const palette = resolvePalette(c);
  const warnings = paletteWarnings(palette);
  return (
    <div className="card">
      <Section title="Couleurs des fiches" hint="Elles s’appliquent à l’aperçu, à l’impression et aux exports PDF et PNG de toutes tes fiches, sur cet appareil. Le fond reste blanc et le texte noir.">
        <div className="swatches" role="group" aria-label="Palette des fiches">
          {PRESETS.map((p) => (
            <button key={p.id} className="swatch" aria-pressed={c.preset === p.id} onClick={() => update({ ...c, preset: p.id })}>
              <i style={{ background: bande(p.palette) }} />{p.label}
            </button>
          ))}
          <button className="swatch" aria-pressed={c.preset === 'perso'} onClick={() => update({ ...c, preset: 'perso' })}>
            <i style={{ background: bande(resolvePalette({ preset: 'perso', custom: c.custom })) }} />Personnalisé
          </button>
        </div>
        {c.preset === 'perso' && (
          <div className="colors" style={{ marginTop: 16 }}>
            {CHAMPS.map((f) => (
              <label key={f.key}>
                {f.label}
                <input type="color" value={palette[f.key]} onChange={(e) => update({ preset: 'perso', custom: { ...palette, [f.key]: e.target.value.toUpperCase() } })} />
              </label>
            ))}
          </div>
        )}
        <div className="palette-preview" aria-hidden="true" style={{ ['--f-rouge' as string]: palette.titre, ['--f-rouge-fonce' as string]: palette.sousTitre, ['--f-rose' as string]: palette.logo }}>
          <span className="pp-logo">sequentia</span>
          <span className="pp-titre">Théorème de Rolle</span>
          <span className="pp-sous">Énoncé et conséquences</span>
          <span className="pp-piege">Piège : oublier l’hypothèse de dérivabilité.</span>
        </div>
        {warnings.map((w) => <Notice key={w} kind="error">{w}</Notice>)}
        <div className="toolbar" style={{ marginTop: 16, marginBottom: 0 }}>
          <button onClick={() => update(DEFAULT_COULEURS)}>Revenir à la charte Séquentia</button>
        </div>
      </Section>
    </div>
  );
}
