import { AuthError, BlockedError, NetworkError, RateLimitError, ServerBusyError } from '../errors';

export type Msg = { role: 'user' | 'model'; text: string };
export type GeminiResult = { text: string; finishReason?: string };

/** Statuts qui signalent une surcharge ou une panne passagère : on réessaie. */
export const RETRYABLE_STATUS = new Set([500, 502, 503, 504, 529]);

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

type PostOpts = { key: string; model: string; body: unknown; fetchImpl?: typeof fetch };

/** Envoie un corps `generateContent` à Gemini ; renvoie le texte ET la raison d'arrêt ; traduit les échecs en erreurs typées. */
export async function postGeminiDetailed(o: PostOpts): Promise<GeminiResult> {
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
  if (RETRYABLE_STATUS.has(r.status)) throw new ServerBusyError(r.status);
  if (!r.ok) throw new NetworkError(`Gemini a répondu ${r.status}`);
  const j = (await r.json()) as {
    candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  const cand = j.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  const finishReason = cand?.finishReason;
  if (!text) {
    if (j.promptFeedback?.blockReason) throw new BlockedError(j.promptFeedback.blockReason);
    if (finishReason && ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST'].includes(finishReason)) throw new BlockedError(finishReason);
    throw new NetworkError('Réponse vide de Gemini');
  }
  return { text, finishReason };
}

/** Comme postGeminiDetailed, mais ne renvoie que le texte. */
export async function postGemini(o: PostOpts): Promise<string> {
  return (await postGeminiDetailed(o)).text;
}

export function buildBody(system: string, messages: Msg[]): unknown {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
  };
}

export function callGemini(o: { key: string; model: string; system: string; messages: Msg[]; fetchImpl?: typeof fetch }): Promise<string> {
  return postGemini({ key: o.key, model: o.model, fetchImpl: o.fetchImpl, body: buildBody(o.system, o.messages) });
}
