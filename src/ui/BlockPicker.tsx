import { useEffect, useState } from 'react';
import { blockLabel, refFromFiche, type Ref } from '../lib/generate/refs';
import type { Fiche } from '../lib/types';

/** Liste les blocs d'une fiche de la bibliothèque : on coche ceux à envoyer vers Générer, ou on envoie la fiche entière. */
export default function BlockPicker({ fiche, path, onSend }: { fiche: Fiche; path: string; onSend: (ref: Ref) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => setPicked(new Set()), [path]);
  const key = (p: number, i: number) => `${p}.${i}`;
  const all = fiche.pages.flatMap((pg, p) => pg.blocks.map((_, i) => key(p, i)));
  const toggle = (k: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <details className="adv blockpicker">
      <summary>Choisir des blocs pour Générer ({all.length})</summary>
      <p className="muted" style={{ margin: '0 0 8px' }}>Coche les blocs à réutiliser : ils s’ajoutent aux références de l’écran Générer.</p>
      {fiche.pages.map((pg, p) => (
        <fieldset key={p} className="blockpage">
          <legend>Page {p + 1}{pg.titre_page ? ` · ${pg.titre_page}` : ''}</legend>
          <ul className="lots">
            {pg.blocks.map((b, i) => (
              <li key={i}>
                <label className="check">
                  <input type="checkbox" checked={picked.has(key(p, i))} onChange={() => toggle(key(p, i))} />
                  <span>{blockLabel(b)}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <button className="btn" disabled={picked.size === 0} onClick={() => onSend(refFromFiche(fiche, path, (p, i) => picked.has(key(p, i))))}>Envoyer la sélection ({picked.size})</button>
        <button className="btn ghost" onClick={() => onSend(refFromFiche(fiche, path))}>Envoyer toute la fiche ({all.length})</button>
        <span className="sp" />
        <button onClick={() => setPicked(new Set(picked.size === all.length ? [] : all))}>{picked.size === all.length ? 'Tout décocher' : 'Tout cocher'}</button>
      </div>
    </details>
  );
}
