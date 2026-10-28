import { AuthError, NetworkError, RateLimitError } from '../errors';

export type Msg = { role: 'user' | 'model'; text: string };

async function retryAfterSec(r: Response): Promise<number> {
  const h = Number(r.headers.get('retry-after'));
  if (Number.isFinite(h) && h > 0) return Math.ceil(h);
  try {
    const j = (await r.clone().json()) as { error?: { details?: { retryDelay?: string }[] } };
    const d = j.error?.details?.find((x) => typeof x.retryDelay === 'string')?.retryDelay;
    const m = d?.match(/(\d+(?:\.\d+)?)s/);
    if (m) return Math.ceil(Number(m[1]));
  } catch { /* corps absent */ }
  return 30;
}

/** Envoie un corps `generateContent` à Gemini et renvoie le texte ; traduit les échecs en erreurs typées. */
export async function postGemini(o: { key: string; model: string; body: unknown; fetchImpl?: typeof fetch }): Promise<string> {
  const f = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let r: Response;
  try {
    r = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model)}:generateContent?key=${encodeURIComponent(o.key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(o.body),
    });
  } catch {
    // Une erreur CORS peut masquer un 503 : on ne dit jamais « clé invalide » ici.
    throw new NetworkError("Gemini n'a pas répondu");
  }
  if (r.status === 429) throw new RateLimitError(await retryAfterSec(r));
  if (r.status === 401 || r.status === 403) throw new AuthError('Clé refusée');
  if (r.status === 400 && /api key/i.test(await r.clone().text())) throw new AuthError('Clé refusée');
  if (!r.ok) throw new NetworkError(`Gemini a répondu ${r.status}`);
  const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new NetworkError('Réponse vide de Gemini');
  return text;
}

export function callGemini(o: { key: string; model: string; system: string; messages: Msg[]; fetchImpl?: typeof fetch }): Promise<string> {
  return postGemini({
    key: o.key, model: o.model, fetchImpl: o.fetchImpl,
    body: {
      systemInstruction: { parts: [{ text: o.system }] },
      contents: o.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
    },
  });
}
