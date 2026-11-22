export class RateLimitError extends Error {
  retryAfterSec: number;
  /** true quand c'est notre plafond local (RequestBudget) qui bloque, pas Gemini. */
  local: boolean;
  constructor(retryAfterSec: number, local = false) {
    super(`Quota atteint, réessayer dans ${retryAfterSec} s`);
    this.name = 'RateLimitError';
    this.retryAfterSec = retryAfterSec;
    this.local = local;
  }
}
export class AuthError extends Error {
  constructor(message = 'Clé ou jeton refusé') { super(message); this.name = 'AuthError'; }
}
export class NetworkError extends Error {
  constructor(message = 'Pas de réponse du réseau') { super(message); this.name = 'NetworkError'; }
}
/** Gemini est surchargé ou en panne passagère (500, 502, 503, 504, 529) : cela vaut la peine de réessayer. */
export class ServerBusyError extends NetworkError {
  status: number;
  constructor(status: number) {
    super(`Serveur surchargé (${status})`);
    this.name = 'ServerBusyError';
    this.status = status;
  }
}
/** La réponse s'est arrêtée parce qu'elle a atteint la limite de longueur (finishReason MAX_TOKENS). */
export class TruncatedError extends Error {
  constructor(message = 'Réponse tronquée par Gemini') { super(message); this.name = 'TruncatedError'; }
}
/** Gemini a refusé de traiter le contenu (filtre de sécurité, récitation…). */
export class BlockedError extends Error {
  reason: string;
  constructor(reason: string) { super(`Contenu refusé par Gemini (${reason})`); this.name = 'BlockedError'; this.reason = reason; }
}
export class ConflictError extends Error {
  constructor(message = 'Le fichier a changé ailleurs') { super(message); this.name = 'ConflictError'; }
}
export class NotFoundError extends Error {
  constructor(message = 'Fichier introuvable') { super(message); this.name = 'NotFoundError'; }
}
