import katex from 'katex';
import { MACROS } from './macros';

/** Texte avec $…$ et $$…$$ ; le reste est inséré comme TEXTE (jamais comme HTML). */
export function renderRich(text: string, errors: string[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    const span = document.createElement('span');
    const display = m[1] !== undefined;
    try {
      katex.render(display ? m[1] : m[2], span, {
        displayMode: display, macros: { ...MACROS }, throwOnError: true, strict: 'error',
      });
    } catch (e) {
      errors.push(String((e as Error).message ?? e));
      span.textContent = m[0];
    }
    frag.append(span);
    last = re.lastIndex;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}
