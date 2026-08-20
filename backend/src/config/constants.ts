/**
 * Constantes applicatives : identiques dans tous les environnements, mais
 * qui ne doivent pas être éparpillées dans le code.
 *
 * Elles ne sont **pas** dans `.env` — les y mettre signifierait qu'elles
 * peuvent différer d'un déploiement à l'autre. Une expiration d'invitation de
 * 7 jours en développement et 30 en production, c'est un bug qui ne se
 * reproduit jamais en local.
 */

/** Durée de validité d'une invitation (architecture/invitations.md). */
export const INVITATION_EXPIRY_DAYS = 7;
