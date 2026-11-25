import { getSettings } from '../lib/storage/settings';
import { AuthError, BlockedError, ConflictError, NetworkError, NotFoundError, RateLimitError, ServerBusyError, TruncatedError } from '../lib/errors';

/** Message pour l'utilisateur : ce qui s'est passé, puis quoi faire, sans jargon. */
export function messageFor(err: unknown, ctx: { offline?: boolean; source?: 'gemini' | 'github' } = {}): string {
  const source = ctx.source ?? 'gemini';
  if (err instanceof RateLimitError) return `Quota atteint. Réessaie dans ${err.retryAfterSec} secondes`;
  if (err instanceof ServerBusyError) return `${source === 'github' ? 'GitHub' : 'Gemini'} est surchargé (${err.status}) malgré plusieurs essais. ${source === 'github' ? '' : getSettings().modelSecours.trim() ? 'Bascule sur le modèle de secours avec le bouton « Modèle utilisé », ou réessaie' : 'Renseigne un modèle de secours dans Réglages, ou réessaie'} dans quelques minutes, ta progression est gardée`;
  if (err instanceof TruncatedError) return 'La réponse était trop longue et a été coupée. Réduis le nombre de pages par lot dans Réglages';
  if (err instanceof BlockedError) return `Gemini a refusé de traiter ce contenu (${err.reason}). Reformule ou saute cette page`;
  if (err instanceof NetworkError) {
    if (ctx.offline) return 'Hors connexion. Enregistrement impossible, ton brouillon est conservé';
    return source === 'github' ? "GitHub n'a pas répondu. Réessayer" : "Gemini n'a pas répondu. Réessayer";
  }
  if (err instanceof AuthError) return source === 'github' ? 'Ajoute ou renouvelle ton jeton GitHub dans Réglages' : 'Ajoute ta clé Gemini dans Réglages';
  if (err instanceof ConflictError) return 'Cette fiche a changé. Comparer, écraser ou annuler';
  if (err instanceof NotFoundError) return 'Fichier introuvable dans le dépôt';
  return 'Une erreur est survenue. Réessayer';
}
