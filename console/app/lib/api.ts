/**
 * L'API de gestion.
 *
 * Le chemin est relatif — `/api/…` — et le proxy de développement l'envoie au
 * backend, ce qui rend la requête *same-origin* et le cookie de session
 * naturellement joint. La console ne connaît donc l'adresse du backend nulle
 * part dans son code.
 *
 * Ce n'est pas encore le client typé : il sera **généré depuis la spec
 * OpenAPI**, récupérée par HTTP sur le serveur en marche. En attendant, chaque
 * appelant déclare la forme qu'il attend.
 */

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

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
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

  return response.status === 204 ? (undefined as T) : response.json();
}

export const postJson = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });

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
