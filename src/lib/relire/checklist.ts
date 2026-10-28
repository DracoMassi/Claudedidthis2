const DEFAUT = ['Hypothèses explicites (intervalle, a ≤ b)', 'Quantificateurs corrects', 'Notations et macros de la charte'];

/** Puces sous « ## Checklist de relecture » dans charte.md ; liste par défaut si la section manque. */
export function parseChecklist(charteMd: string): string[] {
  const items: string[] = [];
  let dedans = false;
  for (const line of charteMd.split(/\r?\n/)) {
    if (/^##\s+/.test(line)) { dedans = /^##\s+checklist de relecture\s*$/i.test(line); continue; }
    const m = dedans && line.match(/^\s*[-*]\s+(.+)$/);
    if (m) items.push(m[1].trim());
  }
  return items.length ? items : [...DEFAUT];
}

export const canValidate = (checked: boolean[]): boolean => checked.length > 0 && checked.every(Boolean);
