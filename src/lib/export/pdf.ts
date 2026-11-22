import type { Format } from '../types';
import { FORMATS } from '../render/formats';

/**
 * Export vectoriel : impression Safari (« Enregistrer dans Fichiers »), polices intégrées.
 * L'appli ne peut pas savoir si un fichier a été créé : `onAfter` signale seulement que la boîte s'est fermée.
 */
export function printPages(format: Format, onAfter?: () => void): void {
  const { width, height } = FORMATS[format];
  let style = document.getElementById('print-page-style') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'print-page-style';
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${width}px ${height}px; margin: 0 }`;
  if (onAfter) window.addEventListener('afterprint', onAfter, { once: true });
  window.print();
}
