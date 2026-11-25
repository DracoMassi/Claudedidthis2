import { useEffect, useMemo, useState } from 'react';
import { resolvePalette, type FichePalette } from '../lib/render/palette';
import { getSettings } from '../lib/storage/settings';

/** Palette des fiches choisie dans les réglages, mise à jour dès qu'elle change (aperçu, export). */
export function useFichePalette(): FichePalette {
  const [c, setC] = useState(() => getSettings().ficheCouleurs);
  useEffect(() => {
    const f = () => setC(getSettings().ficheCouleurs);
    window.addEventListener('sequentia-settings-changed', f);
    return () => window.removeEventListener('sequentia-settings-changed', f);
  }, []);
  const key = JSON.stringify(c);
  return useMemo(() => resolvePalette(c), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
