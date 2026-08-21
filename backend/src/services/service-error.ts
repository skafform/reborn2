import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Un refus métier : la requête est comprise, elle est refusée pour une raison
 * que l'appelant peut lire.
 *
 * ⚠️ **Base commune, et pas quatre classes indépendantes.** `onError` ne
 * connaissait que deux des trois qui existaient, et toute `ApiKeyError`
 * remontait donc en 500 — dont le 409 « révoquer avant de supprimer », qui est
 * précisément le refus sur lequel un utilisateur doit agir. Un seul
 * `instanceof` referme la question pour les suivantes.
 *
 * Les sous-classes restreignent `status` à ce qu'elles émettent réellement :
 * la base dit qu'il y en a un, elles disent lesquels.
 *
 * `reason` est un **code stable**, pas une phrase. C'est lui que la console
 * traduit ; le message reste en français, destiné au développeur.
 */
export class ServiceError extends Error {
  readonly status: ContentfulStatusCode;
  readonly reason: string;

  constructor(status: ContentfulStatusCode, reason: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.reason = reason;
  }
}
