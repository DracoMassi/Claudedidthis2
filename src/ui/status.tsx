import { useEffect, useState, type ReactNode } from 'react';
import { clearJournal, recentAttempts, type AttemptEvent } from '../lib/gemini/journal';
import type { LotStatus } from '../lib/cours/queue';

export type UiState = 'pending' | 'running' | 'ok' | 'suspect' | 'failed' | 'retry';
const LABEL: Record<UiState, string> = {
  pending: 'En attente', running: 'En cours', ok: 'Vérifié', suspect: 'À contrôler', failed: 'Échec', retry: 'Nouvel essai',
};

function Icon({ state }: { state: UiState }) {
  const p = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (state === 'ok') return <svg {...p}><path d="M5 13l4 4L19 7" /></svg>;
  if (state === 'suspect') return <svg {...p}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.5v.01" /></svg>;
  if (state === 'failed') return <svg {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>;
  if (state === 'running' || state === 'retry') return <svg {...p} className="spin"><path d="M21 12a9 9 0 0 0-9-9" /></svg>;
  return <svg {...p}><circle cx="12" cy="12" r="8" /></svg>;
}

/** Pastille d'état : l'icône et le texte portent le sens, la couleur ne fait que le renforcer. */
export function StatusBadge({ state, children }: { state: UiState; children?: ReactNode }) {
  return <span className="sbadge" data-s={state}><Icon state={state} /><span>{children ?? LABEL[state]}</span></span>;
}

/** Barre segmentée : un segment par lot, coloré selon son état. */
export function SegmentBar({ segments, label }: { segments: { state: UiState; title: string }[]; label: string }) {
  return (
    <div className="segbar" role="img" aria-label={label}>
      {segments.map((s, i) => <span key={i} data-s={s.state} title={`${s.title} : ${LABEL[s.state]}`} />)}
    </div>
  );
}

/** Phrase de résumé d'un lot, pour la liste « Imports en cours ». */
export function describeLot(l: LotStatus): string {
  if (l.state === 'pending') return 'pas encore traité';
  if (l.state === 'failed' || l.state === 'suspect') return (l.notes ?? []).join(' · ') || 'à relire';
  const bits: string[] = [];
  if (l.coverage !== undefined) bits.push(`couverture ${Math.round(l.coverage * 100)} %`);
  if (l.split) bits.push('retranscrit page par page');
  return bits.join(' · ') || 'repères de page contrôlés';
}

const OUTCOME: Record<AttemptEvent['outcome'], string> = { ok: 'ok', busy: 'surchargé', quota: 'quota', network: 'réseau', auth: 'clé refusée', other: 'erreur' };

/** Journal des derniers appels (modèle, essai, résultat, durée) : sert à voir quel modèle échoue et à quelle fréquence. */
export function AttemptLog({ refreshKey }: { refreshKey?: unknown }) {
  const [list, setList] = useState<AttemptEvent[]>([]);
  useEffect(() => { setList(recentAttempts().slice().reverse()); }, [refreshKey]);
  if (list.length === 0) return null;
  return (
    <details className="attempts">
      <summary>Détails des appels ({list.length})</summary>
      <ul>
        {list.slice(0, 15).map((e, i) => (
          <li key={i}>
            <StatusBadge state={e.outcome === 'ok' ? 'ok' : e.outcome === 'busy' || e.outcome === 'quota' || e.outcome === 'network' ? 'retry' : 'failed'}>{OUTCOME[e.outcome]}{e.status ? ` ${e.status}` : ''}</StatusBadge>{' '}
            {e.model} · essai {e.attempt}{e.ms !== undefined ? ` · ${(e.ms / 1000).toFixed(1)} s` : ''} · {new Date(e.t).toLocaleTimeString('fr-FR')}
          </li>
        ))}
      </ul>
      <button className="btn ghost" onClick={() => { clearJournal(); setList([]); }}>Effacer le journal</button>
    </details>
  );
}
