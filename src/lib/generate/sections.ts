export type Section = { titre: string; texte: string };

/** Découpe un cours Markdown selon ses titres `## ` ; ce qui précède le premier titre est ignoré. */
export function splitSections(md: string): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) { cur = { titre: m[1].trim(), texte: '' }; out.push(cur); }
    else if (cur) cur.texte += (cur.texte ? '\n' : '') + line;
  }
  return out.map((s) => ({ ...s, texte: s.texte.trim() }));
}
