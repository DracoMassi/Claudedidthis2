import { describe, expect, it } from 'vitest';
import { messageFor } from '../src/ui/messages';
import { AuthError, ConflictError, NetworkError, NotFoundError, RateLimitError } from '../src/lib/errors';
import { slugify } from '../src/lib/slug';

describe('messageFor', () => {
  it('quota atteint, avec le délai', () => expect(messageFor(new RateLimitError(12))).toBe('Quota atteint. Réessaie dans 12 secondes'));
  it('Gemini ne répond pas (jamais « clé invalide »)', () => expect(messageFor(new NetworkError())).toBe("Gemini n'a pas répondu. Réessayer"));
  it('clé Gemini', () => expect(messageFor(new AuthError())).toBe('Ajoute ta clé Gemini dans Réglages'));
  it('conflit de fiche', () => expect(messageFor(new ConflictError())).toBe('Cette fiche a changé. Comparer, écraser ou annuler'));
  it('hors connexion', () => {
    expect(messageFor(new NetworkError(), { offline: true })).toBe('Hors connexion. Enregistrement impossible, ton brouillon est conservé');
  });
  it('les erreurs du dépôt parlent de GitHub, pas de Gemini', () => {
    expect(messageFor(new NetworkError(), { source: 'github' })).toBe("GitHub n'a pas répondu. Réessayer");
    expect(messageFor(new AuthError(), { source: 'github' })).toBe('Ajoute ou renouvelle ton jeton GitHub dans Réglages');
  });
  it('fichier introuvable et erreur inconnue', () => {
    expect(messageFor(new NotFoundError())).toBe('Fichier introuvable dans le dépôt');
    expect(messageFor(new Error('x'))).toBe('Une erreur est survenue. Réessayer');
  });
});

describe('slugify', () => {
  it('enlève accents et ponctuation', () => expect(slugify('Théorème des valeurs intermédiaires')).toBe('theoreme-des-valeurs-intermediaires'));
  it('gère les cas limites', () => {
    expect(slugify('  ')).toBe('');
    expect(slugify("L'intégrale d'une fonction !")).toBe('l-integrale-d-une-fonction');
  });
});
