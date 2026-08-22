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
  /**
   * Les **faits** du refus, quand il en a — jamais sa mise en forme.
   *
   * ⚠️ **Des identités machine, jamais des libellés.** « Référencé par ces
   * documents-ci, par ces champs-là » est un fait ; le titre qu'un écran leur
   * donne est une **convention de console**. Résoudre les titres ici les
   * ferait fuir dans le contrat d'API, et la forme du corps changerait le jour
   * où la convention change. Le serveur énonce, chaque consommateur habille.
   */
  readonly details?: unknown;

  constructor(
    status: ContentfulStatusCode,
    reason: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.reason = reason;
    if (details !== undefined) this.details = details;
  }
}
