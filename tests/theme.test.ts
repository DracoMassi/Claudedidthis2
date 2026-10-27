import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync('src/theme/theme.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

const VARS: Record<string, string> = {
  '--page-bg': '#F8E8EC', '--grid-line': '#EFCDD5', '--card': '#FFFFFF', '--card-border': '#E4B9C2',
  '--accent': '#DD0033', '--accent-text': '#DD0033', '--accent-dark': '#7C011D', '--logo': '#A8586B',
  '--badge-bg': '#F3D9DF', '--ok-bg': '#E3F0DC', '--ok-text': '#27500A', '--text': '#1B1B1B',
};

describe('theme.css (valeurs claires du préréglage ac)', () => {
  for (const [name, value] of Object.entries(VARS)) {
    it(`définit ${name}: ${value}`, () => {
      expect(css).toContain(`${name}: ${value}`);
    });
  }
});

describe('index.html', () => {
  it('a une CSP dont connect-src vaut exactement les deux API autorisées', () => {
    const m = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    expect(m).not.toBeNull();
    const connect = m![1].split(';').map((s) => s.trim()).find((s) => s.startsWith('connect-src'));
    expect(connect).toBe('connect-src https://api.github.com https://generativelanguage.googleapis.com');
  });
  it('ne charge aucun script externe', () => {
    expect(html).not.toMatch(/<script[^>]+src="https?:/);
  });
});
