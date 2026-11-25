import { useEffect, useState } from 'react';
import { PRESETS } from '../lib/render/palette';
import { getSettings, saveSettings } from '../lib/storage/settings';
import { SelectField } from './Field';

/** Choix rapide des couleurs des fiches à côté de l'aperçu ; le détail (couleurs personnalisées) est dans Réglages. */
export default function PaletteQuick() {
  const [c, setC] = useState(() => getSettings().ficheCouleurs);
  useEffect(() => {
    const f = () => setC(getSettings().ficheCouleurs);
    window.addEventListener('sequentia-settings-changed', f);
    return () => window.removeEventListener('sequentia-settings-changed', f);
  }, []);
  return (
    <div className="modelrow">
      <SelectField label="Couleurs des fiches" value={c.preset} onChange={(e) => {
        saveSettings({ ficheCouleurs: { ...getSettings().ficheCouleurs, preset: e.target.value } });
        window.dispatchEvent(new Event('sequentia-settings-changed'));
      }}>
        {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        <option value="perso">Personnalisé (voir Réglages)</option>
      </SelectField>
    </div>
  );
}
