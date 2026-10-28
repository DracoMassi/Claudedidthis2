export class JsonError extends Error {
  code = 'json' as const;
  constructor(message: string) { super(message); this.name = 'JsonError'; }
}

/** Extrait un objet JSON d'une réponse de modèle (balises de code, texte autour). Lève JsonError si illisible ou tronqué. */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1];
  try { return JSON.parse(t); } catch { /* essai suivant */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* illisible */ }
  }
  throw new JsonError('Réponse JSON invalide ou tronquée');
}
