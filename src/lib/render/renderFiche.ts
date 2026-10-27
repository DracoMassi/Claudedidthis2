import type { Block, Fiche } from '../types';
import { FORMATS } from './formats';
import { renderRich } from './rich';
import { sanitizeSvg } from './sanitizeSvg';

const MATIERES: Record<string, string> = {
  maths: 'Mathématiques', physique: 'Physique', chimie: 'Chimie', si: "Sciences de l'ingénieur",
  philosophie: 'Philosophie', histoire: 'Histoire',
};
const NIVEAUX: Record<string, string> = { terminale: 'Terminale', mpsi: 'MPSI' };

const str = (b: Block, k: string): string => (typeof b[k] === 'string' ? (b[k] as string) : '');
const arr = (b: Block, k: string): string[] => (Array.isArray(b[k]) ? (b[k] as string[]) : []);

export function renderFiche(root: HTMLElement, fiche: Fiche): { katexErrors: string[] } {
  const errors: string[] = [];
  const el = (tag: string, cls?: string, text?: string): HTMLElement => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.append(renderRich(text, errors));
    return e;
  };
  const list = (items: string[], tag: 'ul' | 'ol'): HTMLElement => {
    const l = el(tag);
    items.forEach((i) => l.append(el('li', undefined, i)));
    return l;
  };

  const blockNodes = (b: Block): HTMLElement[] => {
    switch (b.type) {
      case 'definition': return [el('h2', 'bloc-titre', str(b, 'terme')), el('p', undefined, str(b, 'enonce'))];
      case 'theoreme': {
        const hyp = arr(b, 'hypotheses');
        return [el('h2', 'bloc-titre', str(b, 'nom')), ...(hyp.length ? [el('p', undefined, 'Hypothèses :'), list(hyp, 'ul')] : []), el('p', undefined, str(b, 'enonce'))];
      }
      case 'demonstration': return [el('h2', 'bloc-titre', str(b, 'titre')), list(arr(b, 'etapes'), 'ol')];
      case 'methode': return [el('h2', 'bloc-titre', str(b, 'titre')), list(arr(b, 'etapes'), 'ol')];
      case 'formule': {
        const d = el('div', 'formule', `$$${str(b, 'latex')}$$`);
        if (str(b, 'legende')) d.append(el('div', 'legende', str(b, 'legende')));
        return [d];
      }
      case 'piege': return [el('h2', 'bloc-titre', 'Piège'), el('p', 'piege-texte', `✗ ${str(b, 'texte')}`), el('p', 'piege-correction', `✓ ${str(b, 'correction')}`)];
      case 'exemple': return [el('h2', 'bloc-titre', 'Exemple'), el('p', undefined, str(b, 'enonce')), el('p', 'solution', `→ ${str(b, 'solution')}`)];
      case 'qcm': {
        const l = list(arr(b, 'choix'), 'ol');
        l.classList.add('qcm-choix');
        const rep = typeof b.reponse === 'number' ? String.fromCharCode(65 + b.reponse) : '?';
        return [el('h2', 'bloc-titre', 'QCM'), el('p', undefined, str(b, 'question')), l, el('p', 'solution', `Réponse : ${rep} — ${str(b, 'explication')}`)];
      }
      case 'proprietes': {
        const items = Array.isArray(b.items) ? (b.items as { nom: string; enonce: string }[]) : [];
        return [el('h2', 'bloc-titre', str(b, 'titre')), ...items.map((it) => {
          const d = el('p', 'propriete');
          d.append(el('strong', undefined, `${it.nom} : `), renderRich(it.enonce, errors));
          return d;
        })];
      }
      case 'figure': {
        const d = el('div', 'figure');
        d.innerHTML = sanitizeSvg(str(b, 'svg')); // SVG filtré : seul innerHTML autorisé
        if (str(b, 'legende')) d.append(el('div', 'legende', str(b, 'legende')));
        return [d];
      }
      default: return [el('p', undefined, `[bloc « ${String(b.type)} » non pris en charge]`)];
    }
  };

  root.innerHTML = '';
  root.setAttribute('data-fiche', '');
  const fmt = FORMATS[fiche.meta.format ?? 'fiche'];
  const n = fiche.pages.length;
  fiche.pages.forEach((p, i) => {
    const page = el('section', 'fiche-page');
    page.style.width = `${fmt.width}px`;
    page.style.height = `${fmt.height}px`;
    const head = el('header', 'fiche-entete');
    head.append(el('span', 'fiche-logo', 'sequentia'));
    head.append(el('span', 'fiche-matiere', `${MATIERES[fiche.meta.matiere] ?? fiche.meta.matiere} · ${NIVEAUX[fiche.meta.niveau] ?? fiche.meta.niveau}`));
    page.append(head, el('h1', 'fiche-titre', fiche.meta.titre));
    if (p.titre_page) page.append(el('h3', 'fiche-sous-titre', p.titre_page));
    const corps = el('div', 'fiche-corps');
    p.blocks.forEach((b) => {
      const sec = el('div', `bloc bloc-${b.type}`);
      blockNodes(b).forEach((node) => sec.append(node));
      corps.append(sec);
    });
    page.append(corps);
    const foot = el('footer', 'fiche-pied');
    foot.append(el('span', undefined, 'Séquentia'), el('span', undefined, `${i + 1}/${n}`));
    page.append(foot);
    root.append(page);
  });
  return { katexErrors: errors };
}

export function checkOverflow(root: HTMLElement): number[] {
  return [...root.querySelectorAll<HTMLElement>('.fiche-page')].flatMap((p, i) =>
    p.scrollHeight > p.clientHeight + 1 ? [i + 1] : [],
  );
}
