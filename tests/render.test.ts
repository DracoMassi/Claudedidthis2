import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { renderFiche, checkOverflow } from '../src/lib/render/renderFiche';
import { renderRich } from '../src/lib/render/rich';
import { sanitizeSvg } from '../src/lib/render/sanitizeSvg';
import { FORMATS } from '../src/lib/render/formats';
import type { Fiche } from '../src/lib/types';

const v11: Fiche = JSON.parse(readFileSync('tests/fixtures/fiche-v11.json', 'utf8'));
const v10: Fiche = JSON.parse(readFileSync('tests/fixtures/fiche-v10.json', 'utf8'));
const withBlocks = (blocks: Fiche['pages'][0]['blocks']): Fiche => ({ ...v10, pages: [{ blocks }] });
const render = (f: Fiche) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const r = renderFiche(root, f);
  return { root, ...r };
};

describe('renderRich', () => {
  it('rend toutes les macros de la charte sans erreur KaTeX', () => {
    const errors: string[] = [];
    renderRich('$\\dd x$ $\\e^{x}$ $\\R$ $\\inte{1}{n}$ $\\abs{x}$ $\\card(E)$ $\\i$ $\\eps$', errors);
    expect(errors).toEqual([]);
  });
  it('signale une commande inconnue', () => {
    const errors: string[] = [];
    renderRich('$\\commandeinconnue{x}$', errors);
    expect(errors.join(' ')).toContain('Undefined control sequence');
  });
  it('insère le HTML comme texte, sans créer d’élément', () => {
    const frag = renderRich('<img src=x onerror=alert(1)>', []);
    const div = document.createElement('div');
    div.appendChild(frag);
    expect(div.querySelector('img')).toBeNull();
    expect(div.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('sanitizeSvg', () => {
  it('retire script, foreignObject et attributs on*', () => {
    const out = sanitizeSvg(
      "<svg xmlns='http://www.w3.org/2000/svg' onload='x()'><script>alert(1)</script><foreignObject><div/></foreignObject><circle cx='5' cy='5' r='4' onclick='y()'/></svg>",
    );
    expect(out).not.toMatch(/script|foreignObject|onload|onclick/i);
    expect(out).toContain('circle');
  });
  it('renvoie une chaîne vide si le SVG est illisible', () => {
    expect(sanitizeSvg('<svg><')).toBe('');
  });
});

describe('renderFiche', () => {
  it('rend la fiche v1.0 sans erreur KaTeX et marque la racine data-fiche', () => {
    const { root, katexErrors } = render(v10);
    expect(katexErrors).toEqual([]);
    expect(root.hasAttribute('data-fiche')).toBe(true);
  });
  it("utilise le nom d'un théorème comme titre de bloc", () => {
    const { root } = render(v10);
    const titres = [...root.querySelectorAll('.bloc-titre')].map((e) => e.textContent);
    expect(titres).toContain('Théorème fondamental');
  });
  it('affiche chaque nom d’un bloc proprietes et le SVG filtré', () => {
    const { root } = render(v11);
    expect(root.textContent).toContain('Linéarité');
    expect(root.textContent).toContain('Positivité');
    expect(root.querySelector('svg circle')).not.toBeNull();
  });
  it('remonte les erreurs KaTeX', () => {
    const { katexErrors } = render(withBlocks([{ type: 'definition', terme: 'X', enonce: 'Cassé $\\commandeinconnue{x}$' }]));
    expect(katexErrors.length).toBe(1);
  });
  it('donne à chaque page les dimensions du format', () => {
    const { root } = render(v10);
    const page = root.querySelector('.fiche-page') as HTMLElement;
    expect(page.style.width).toBe(`${FORMATS.fiche.width}px`);
    expect(page.style.height).toBe(`${FORMATS.fiche.height}px`);
  });
});

describe('checkOverflow', () => {
  it('renvoie [1] quand la première page déborde', () => {
    const { root } = render(v10);
    const page = root.querySelector('.fiche-page') as HTMLElement;
    Object.defineProperty(page, 'scrollHeight', { value: 2000 });
    Object.defineProperty(page, 'clientHeight', { value: 1754 });
    expect(checkOverflow(root)).toEqual([1]);
  });
  it('renvoie [] quand rien ne déborde', () => {
    const { root } = render(v10);
    expect(checkOverflow(root)).toEqual([]);
  });
});

describe('formats et charte des fiches', () => {
  it('FORMATS', () => {
    expect(FORMATS.fiche).toEqual({ width: 1240, height: 1754 });
    expect(FORMATS.post).toEqual({ width: 1080, height: 1350 });
  });
  it("le bloc [data-fiche] de theme.css ne dépend d'aucune variable du thème de l'app", () => {
    const css = readFileSync('src/theme/theme.css', 'utf8');
    const bloc = css.match(/\[data-fiche\][^{]*\{[^}]*\}/g)?.join('\n') ?? '';
    expect(bloc.length).toBeGreaterThan(0);
    for (const v of ['--page-bg', '--card', '--text', '--accent', '--grid-line']) expect(bloc).not.toContain(`var(${v}`);
  });
});
