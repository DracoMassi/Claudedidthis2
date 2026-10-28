import { renderRich } from '../render/rich';

const sansFrontMatter = (md: string) => md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

/** Aperçu simplifié d'un cours Markdown (titres, citations, listes, repères de page, formules KaTeX). Tout texte entre comme texte. */
export function renderMarkdownPreview(root: HTMLElement, md: string): { katexErrors: string[] } {
  const errors: string[] = [];
  root.innerHTML = '';
  const el = (tag: string, text: string): HTMLElement => { const e = document.createElement(tag); e.append(renderRich(text, errors)); return e; };
  let para: string[] = [];
  let list: HTMLElement | null = null;
  const flush = () => { if (para.length) { root.append(el('p', para.join(' '))); para = []; } };
  for (const line of sansFrontMatter(md).split(/\r?\n/)) {
    const page = line.match(/^<!--\s*page\s+(\d+)\s*-->\s*$/);
    if (page) { flush(); list = null; const d = document.createElement('div'); d.className = 'page-marker'; d.textContent = `Page ${page[1]}`; root.append(d); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flush(); list = null; root.append(el(`h${h[1].length}`, h[2])); continue; }
    const q = line.match(/^>\s?(.*)$/);
    if (q) { flush(); list = null; root.append(el('blockquote', q[1])); continue; }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { flush(); if (!list) { list = document.createElement('ul'); root.append(list); } list.append(el('li', li[1])); continue; }
    if (!line.trim()) { flush(); list = null; continue; }
    list = null;
    para.push(line.trim());
  }
  flush();
  return { katexErrors: errors };
}
