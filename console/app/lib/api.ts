import { en } from "zod/locales";
import * as z from "zod/mini";

/**
 * L'API de gestion.
 *
 * Le chemin est relatif — `/api/…` — et le proxy de développement l'envoie au
 * backend, ce qui rend la requête *same-origin* et le cookie de session
 * naturellement joint. La console ne connaît donc l'adresse du backend nulle
 * part dans son code.
 *
 * **Chaque réponse est validée** contre le schéma généré depuis le contrat que
 * le serveur publie (`api-contract.ts`). Un type seul ne serait qu'une
 * affirmation : `fetch` renvoie `unknown`, et `api<T>()` disait simplement à
 * TypeScript de faire confiance. Quand la forme réelle changeait, personne ne
 * le savait — une colonne se vidait à l'écran, sans erreur.
 *
 * La validation attrape en plus ce qu'aucune vérification à la compilation ne
 * peut voir : un backend déployé plus récent que la console, ou un onglet resté
 * ouvert pendant un redéploiement.
 *
 * **Les corps envoyés le sont aussi**, par le même contrat et dans l'autre
 * sens. Le typage y fait l'essentiel — `postJson` exige un corps de la forme
 * que le schéma décrit, donc un champ renommé côté serveur casse le typecheck.
 * La validation ajoute ce que le type ne voit pas : une adresse qui n'en est
 * pas une, un identifiant qui n'est pas un UUID.
 */

/**
 * Zod Mini ne charge aucune locale : sans ça, tous les messages se réduisent à
 * « Invalid input ». Le `path` resterait présent — il nomme déjà le champ —
 * mais la phrase complète vaut ces trois lignes.
 */
z.config(en());

export class ApiError extends Error {
  readonly status: number;
  /** Code stable du refus, quand le backend en fournit un — voir `apiErrorMessage`. */
  readonly reason?: string;

  constructor(status: number, message: string, reason?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.reason = reason;
  }
}

/**
 * La réponse ne correspond pas au contrat.
 *
 * Distincte d'`ApiError` : celle-ci dit que le serveur a **refusé**, celle-là
 * qu'il a répondu **autre chose que ce qu'il promet**. La seconde est un défaut
 * à corriger, pas une situation à gérer — d'où le message qui nomme le champ.
 */
export class ContractError extends Error {
  constructor(path: string, issues: string) {
    super(`${path} returned unexpected data — ${issues}`);
    this.name = "ContractError";
  }
}

/**
 * Le corps ne correspond pas au contrat — refusé **avant** d'être envoyé.
 *
 * Contrairement à `ContractError`, celle-ci est montrée à l'écran : son cas
 * atteignable est une valeur saisie que la validation du navigateur a laissée
 * passer, pas un défaut de la console. D'où `issues` conservé tel quel, qui
 * nomme le champ en cause.
 */
export class InvalidRequestError extends Error {
  readonly issues: string;

  constructor(path: string, issues: string) {
    super(`${path} was sent unexpected data — ${issues}`);
    this.name = "InvalidRequestError";
    this.issues = issues;
  }
}

/** `email: Invalid email address ; roleId: …` — le champ, puis ce qui cloche. */
const describeIssues = (error: z.core.$ZodError) =>
  error.issues
    .map((issue) => `${issue.path.join(".") || "(racine)"}: ${issue.message}`)
    .join(" ; ");

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    // Le backend répond `{ error, reason }` sur ses refus. `error` reste en
    // français (message développeur) ; `reason`, lui, est un code stable en
    // anglais — c'est lui que `apiErrorMessage` traduit pour l'affichage.
    const body = await response.json().catch(() => null);
    const message =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : `Request failed (${response.status}).`;
    const reason =
      body && typeof body === "object" && "reason" in body
        ? String(body.reason)
        : undefined;
    throw new ApiError(response.status, message, reason);
  }

  return response.status === 204 ? undefined : await response.json();
}

/**
 * Appelle l'API et valide la réponse contre son schéma.
 *
 * Le type de retour vient du schéma, pas d'un paramètre déclaré à l'appel :
 * il n'y a plus rien à affirmer.
 */
export async function api<S extends z.ZodMiniType>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S>> {
  const body = await request(path, init);
  const parsed = schema.safeParse(body);

  if (!parsed.success) throw new ContractError(path, describeIssues(parsed.error));
  return parsed.data;
}

/** Pour les routes sans corps de réponse — l'annulation d'invitation (204). */
export const apiVoid = (path: string, init?: RequestInit) =>
  request(path, init).then(() => undefined);

/**
 * Envoie un corps décrit par le contrat, et valide la réponse comme `api()`.
 *
 * Le corps est typé **par son schéma** : un champ renommé côté serveur devient
 * une erreur de compilation ici, sans que personne n'ait à y penser. Il est
 * ensuite validé, ce qui n'est pas redondant — `String(form.get("email"))` est
 * un `string` pour TypeScript, quoi qu'il contienne.
 */
export async function postJson<B extends z.ZodMiniType, S extends z.ZodMiniType>(
  path: string,
  bodySchema: B,
  body: z.infer<B>,
  responseSchema: S,
): Promise<z.infer<S>> {
  const checked = parseBody(bodySchema, body, path);
  return api(path, responseSchema, {
    method: "POST",
    body: JSON.stringify(checked),
  });
}

/**
 * Un `PUT` sans corps de réponse — poser un état plutôt que déclencher une
 * action. Suspendre et réactiver sont ainsi la même route, donc idempotentes.
 */
export async function putJson<B extends z.ZodMiniType>(
  path: string,
  bodySchema: B,
  body: z.infer<B>,
): Promise<void> {
  const checked = parseBody(bodySchema, body, path);
  await request(path, { method: "PUT", body: JSON.stringify(checked) });
}

/**
 * Rétrécit une valeur au type du contrat.
 *
 * `FormData` ne rend que des chaînes, alors qu'un corps peut attendre une
 * énumération — les permissions d'un rôle, par exemple. Le schéma généré est
 * l'autorité pour les reconnaître ; l'alternative serait un `as` qui affirme
 * sans vérifier, ou une liste de valeurs recopiée ici, hors de sa source.
 */
export function parseBody<B extends z.ZodMiniType>(
  schema: B,
  value: unknown,
  path = "(corps de requête)",
): z.infer<B> {
  const checked = schema.safeParse(value);
  if (!checked.success)
    throw new InvalidRequestError(path, describeIssues(checked.error));
  return checked.data;
}

/**
 * Le message anglais à montrer, ou `null` si l'erreur n'est pas de celles
 * qu'un écran présente.
 *
 * Un seul endroit décide ce qui s'affiche en bandeau et ce qui remonte à
 * l'`ErrorBoundary`. `ContractError` en est délibérément absente : une réponse
 * hors contrat est un défaut à corriger, pas une situation à présenter
 * poliment — elle doit rester bruyante.
 */
export function displayableError(error: unknown): string | null {
  if (error instanceof ApiError) return apiErrorMessage(error);
  if (error instanceof InvalidRequestError) return error.issues;
  return null;
}

/**
 * Le backend répond en français (message développeur, hors périmètre de ce
 * changement) — jamais affiché directement, pour que la console reste
 * entièrement en anglais.
 *
 * Priorité au code `reason`, stable d'une version à l'autre ; à défaut, un
 * message générique par statut.
 */
function apiErrorMessage(error: ApiError): string {
  const byReason: Record<string, string> = {
    missing_permission: "You don't have permission to do that.",
    escalation: "You can't grant a permission you don't hold yourself.",
    unknown_role: "That role could not be found.",
    unknown_project: "That project could not be found.",
    scope_mismatch:
      "That role doesn't apply here — project roles are granted from a project, organization roles from the organization.",
    already_invited: "There's already a pending invitation for that address.",
    already_member: "That address is already a member.",
    expired: "This invitation has expired.",
    unknown_token: "This invitation link is invalid.",
    rate_limited: "Too many invitations sent recently. Try again later.",
    not_pending: "This invitation is no longer pending.",
  };
  if (error.reason) {
    const known = byReason[error.reason];
    if (known) return known;
  }

  switch (error.status) {
    case 401:
      return "Log in required.";
    case 403:
      return "You don't have permission to do that.";
    case 404:
      return "Not found.";
    case 409:
      return "This conflicts with existing data.";
    case 410:
      return "This has expired.";
    case 429:
      return "Too many requests. Try again later.";
    default:
      return "Something went wrong. Please try again.";
  }
}
