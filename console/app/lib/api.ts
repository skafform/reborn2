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

  if (!parsed.success) {
    throw new ContractError(
      path,
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(racine)"}: ${issue.message}`)
        .join(" ; "),
    );
  }
  return parsed.data;
}

/** Pour les routes sans corps de réponse — l'annulation d'invitation (204). */
export const apiVoid = (path: string, init?: RequestInit) =>
  request(path, init).then(() => undefined);

export const postJson = <S extends z.ZodMiniType>(
  path: string,
  schema: S,
  body: unknown,
) => api(path, schema, { method: "POST", body: JSON.stringify(body) });

/**
 * Le message anglais montré à l'écran. Le backend répond en français
 * (message développeur, hors périmètre de ce changement) — jamais affiché
 * directement, pour que la console reste entièrement en anglais.
 *
 * Priorité au code `reason`, stable d'une version à l'autre ; à défaut, un
 * message générique par statut.
 */
export function apiErrorMessage(error: ApiError): string {
  const byReason: Record<string, string> = {
    missing_permission: "You don't have permission to do that.",
    escalation: "You can't grant a permission you don't hold yourself.",
    unknown_role: "That role could not be found.",
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
      return "Sign in required.";
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
