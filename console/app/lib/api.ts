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

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
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
    // Le backend répond `{ error, reason }` sur ses refus. Un corps illisible
    // ne doit pas masquer le code, qui reste l'information utile.
    const body = await response.json().catch(() => null);
    const message =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : `La requête a échoué (${response.status}).`;
    throw new ApiError(response.status, message);
  }

  return response.status === 204 ? (undefined as T) : response.json();
}

export const postJson = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
