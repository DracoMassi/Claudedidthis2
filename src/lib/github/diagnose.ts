import { AuthError, ConflictError, NetworkError, NotFoundError, RateLimitError } from '../errors';

const CONTENTS = 'Dans GitHub : Settings → Developer settings → Fine-grained tokens → ton jeton → Repository permissions → Contents : « Read and write ». Pense à choisir « Only select repositories » avec le dépôt Fiches.';
const EXPIRED = 'GitHub refuse le jeton (401) : il est expiré, supprimé ou mal collé. Crée-en un nouveau et colle-le sans espace';
const NOT_FOUND = 'Dépôt introuvable (404) : vérifie le propriétaire et le nom du dépôt. Si le dépôt est privé, le jeton doit y avoir accès (« Only select repositories »)';
const EMPTY = 'Le dépôt est vide : ajoute-y un premier fichier, puis recharge';

/** Explique pourquoi la bibliothèque n'a pas pu se charger, au lieu d'accuser toujours le jeton. */
export function libraryMessage(e: unknown): string {
  if (e instanceof AuthError) return e.status === 403 ? `GitHub refuse l'accès au contenu du dépôt (403) : le jeton n'a pas la permission « Contents ». ${CONTENTS}` : EXPIRED;
  if (e instanceof NotFoundError) return NOT_FOUND;
  if (e instanceof ConflictError) return EMPTY;
  if (e instanceof RateLimitError) return `GitHub limite les requêtes. Réessaie dans ${e.retryAfterSec} s`;
  if (e instanceof NetworkError) return "GitHub n'a pas répondu (réseau coupé ou GitHub indisponible). Réessaie";
  return `Erreur inattendue : ${e instanceof Error ? e.message : String(e)}`;
}

/**
 * Teste ce dont l'appli a réellement besoin : voir le dépôt (métadonnées) PUIS lire son contenu (permission Contents).
 * Un jeton sans « Contents » passe le premier test mais échoue sur le second : c'est le piège des jetons fine-grained.
 * Le message de réussite se termine par « connecté ».
 */
export async function diagnoseGithub(o: { owner: string; repo: string; token: string }, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<{ ok: boolean; message: string }> {
  const owner = o.owner.trim(), repo = o.repo.trim(), token = o.token.trim();
  if (!owner || !repo || !token) return { ok: false, message: 'Renseigne le jeton, le propriétaire et le nom du dépôt' };
  const get = async (path: string): Promise<Response | null> => {
    try {
      return await fetchImpl(`https://api.github.com/repos/${owner}/${repo}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    } catch { return null; }
  };
  const fail = (message: string) => ({ ok: false, message });
  const noAnswer = fail("GitHub n'a pas répondu. Réessaie");

  const meta = await get('');
  if (!meta) return noAnswer;
  if (meta.status === 401) return fail(EXPIRED);
  if (meta.status === 404) return fail(NOT_FOUND);
  if (meta.status === 403) return fail(meta.headers.get('x-ratelimit-remaining') === '0' ? 'GitHub limite les requêtes. Réessaie dans quelques minutes' : `GitHub refuse l'accès au dépôt (403). ${CONTENTS}`);
  if (!meta.ok) return fail(`GitHub a répondu ${meta.status}`);

  const tree = await get('/git/trees/HEAD');
  if (!tree) return noAnswer;
  if (tree.status === 403 || tree.status === 404) return fail(`Le jeton voit le dépôt mais pas son contenu (${tree.status}). ${CONTENTS}`);
  if (tree.status === 409) return fail(EMPTY);
  if (!tree.ok) return fail(`GitHub a répondu ${tree.status}`);
  const j = (await tree.json().catch(() => ({}))) as { tree?: { path: string }[] };
  if (!j.tree?.some((e) => e.path === 'corpus')) return fail("Dépôt lisible, mais il n'y a pas de dossier corpus/ à la racine : est-ce bien le dépôt des fiches ?");
  return { ok: true, message: 'GitHub : connecté' };
}
