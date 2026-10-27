import type { Format } from '../types';
import { FORMATS } from '../render/formats';

/** Export principal : impression Safari (« Enregistrer dans Fichiers »), vectoriel, polices intégrées. */
export function printPages(format: Format): void {
  const { width, height } = FORMATS[format];
  let style = document.getElementById('print-page-style') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'print-page-style';
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${width}px ${height}px; margin: 0 }`;
  window.print();
}
