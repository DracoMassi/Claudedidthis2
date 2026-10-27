import type { GithubRepo } from './repo';

const FONTS = [
  { family: 'Andaluz', path: 'fonts/Andaluz-Regular.otf', weight: '400' },
  { family: 'Melbourne', path: 'fonts/melbourne.ttf', weight: '400' },
  { family: 'Melbourne', path: 'fonts/melbournebold.ttf', weight: '700' },
];

/** Charge les polices privées depuis Fiches/fonts/. Ne rejette jamais : en cas d'échec, Inter reste la police de repli. */
export async function loadFonts(repo: Pick<GithubRepo, 'readBinary'>): Promise<{ loaded: string[]; fallback: boolean }> {
  const loaded: string[] = [];
  for (const f of FONTS) {
    try {
      const face = new FontFace(f.family, await repo.readBinary(f.path), { weight: f.weight });
      await face.load();
      document.fonts.add(face);
      if (!loaded.includes(f.family)) loaded.push(f.family);
    } catch {
      /* police indisponible : repli */
    }
  }
  const voulues = new Set(FONTS.map((f) => f.family));
  return { loaded, fallback: loaded.length < voulues.size };
}
