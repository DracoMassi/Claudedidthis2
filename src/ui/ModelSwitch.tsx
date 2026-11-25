import { useEffect, useState } from 'react';
import { getSettings, saveSettings } from '../lib/storage/settings';

/**
 * Bascule entre le modèle principal et le modèle de secours. Le modèle choisi passe en premier, l'autre sert de repli.
 * S'applique au prochain envoi, y compris pendant une génération ou un import en cours.
 */
export default function ModelSwitch({ compact = false }: { compact?: boolean }) {
  const [s, setS] = useState(getSettings());
  useEffect(() => {
    const f = () => setS(getSettings());
    window.addEventListener('sequentia-settings-changed', f);
    return () => window.removeEventListener('sequentia-settings-changed', f);
  }, []);
  const hasAlt = s.modelSecours.trim() !== '';
  const active = hasAlt && s.modeleActif === 'secours' ? 'secours' : 'principal';
  const pick = (v: 'principal' | 'secours') => {
    saveSettings({ modeleActif: v });
    window.dispatchEvent(new Event('sequentia-settings-changed'));
  };
  return (
    <div className="modelswitch" data-compact={compact || undefined}>
      <span className="ms-label">Modèle utilisé</span>
      <div className="ms-group" role="radiogroup" aria-label="Modèle utilisé">
        <button type="button" role="radio" aria-checked={active === 'principal'} onClick={() => pick('principal')}>
          <b>Principal</b><small>{s.model}</small>
        </button>
        <button type="button" role="radio" aria-checked={active === 'secours'} disabled={!hasAlt}
          title={hasAlt ? undefined : 'Renseigne un modèle de secours dans Réglages'} onClick={() => pick('secours')}>
          <b>Secours</b><small>{hasAlt ? s.modelSecours : 'non renseigné'}</small>
        </button>
      </div>
    </div>
  );
}
