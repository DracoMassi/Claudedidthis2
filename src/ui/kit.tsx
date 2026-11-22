import type { ReactNode } from 'react';

/** En-tête d'écran : un titre, une phrase qui dit à quoi sert l'écran. */
export function PageHead({ title, lead }: { title: string; lead?: string }) {
  return (
    <header className="pagehead">
      <h1 className="titre">{title}</h1>
      {lead && <p className="lead">{lead}</p>}
    </header>
  );
}

/** Groupe de champs : un titre court, une aide optionnelle, puis le contenu. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="group">
      <div className="group-head">
        <h2>{title}</h2>
        {hint && <p>{hint}</p>}
      </div>
      {children}
    </section>
  );
}

type Kind = 'info' | 'ok' | 'error';
const PATHS: Record<Kind, ReactNode> = {
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.01" /></>,
  ok: <path d="M5 13l4 4L19 7" />,
  error: <><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.5v.01" /></>,
};

/** Message d'état : l'icône et le texte portent le sens, la couleur le renforce. */
export function Notice({ kind = 'info', children, action }: { kind?: Kind; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="notice" data-k={kind} role={kind === 'error' ? 'alert' : 'status'}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[kind]}</svg>
      <div>{children}</div>
      {action}
    </div>
  );
}

/** Écran vide : dit ce qui manque, puis propose l'action suivante. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Étapes d'une génération : les tours déjà faits se remplissent, le tour en cours respire. */
export function Stepper({ current, total, label }: { current: number; total: number; label: string }) {
  return (
    <div className="stepper" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={current} aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} data-s={i + 1 < current ? 'done' : i + 1 === current ? 'now' : 'todo'} />
      ))}
    </div>
  );
}

/** Pastille de comptage de requêtes : « 12 / 250 » avec une jauge. */
export function Quota({ used }: { used: string }) {
  const [n, max] = used.split('/').map(Number);
  const pct = max ? Math.min(100, Math.round((n / max) * 100)) : 0;
  return (
    <span className="quota" title="Requêtes envoyées à Gemini aujourd'hui">
      <span className="quota-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} data-hot={pct >= 80 ? '1' : undefined} /></span>
      {used ? `${n} sur ${max} requêtes aujourd'hui` : ''}
    </span>
  );
}
