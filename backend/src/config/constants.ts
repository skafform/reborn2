/**
 * Constantes applicatives : identiques dans tous les environnements, mais
 * qui ne doivent pas être éparpillées dans le code.
 *
 * Elles ne sont **pas** dans `.env` — les y mettre signifierait qu'elles
 * peuvent différer d'un déploiement à l'autre. Une expiration d'invitation de
 * 7 jours en développement et 30 en production, c'est un bug qui ne se
 * reproduit jamais en local.
 */

/** Un jour en millisecondes, pour les calculs d'expiration. */
export const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Plafonds des champs libres d'une organization et d'un projet.
 *
 * ⚠️ **Ce ne sont pas des limites de stockage** — la colonne est un `text`,
 * sans borne côté Postgres. Ils existent pour que la validation refuse à la
 * frontière plutôt que de laisser entrer une valeur que rien n'affichera : un
 * nom de 4 000 caractères casse chaque tableau qui le montre.
 *
 * Le plafond du nom vivait en dur dans le handler, ce que la règle des valeurs
 * en dur interdit pour un plafond. Il rejoint les autres ici.
 */
export const NAME_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 1000;
export const BILLING_ADDRESS_MAX_LENGTH = 500;

/** Durée de validité d'une invitation (architecture/invitations.md). */
export const INVITATION_EXPIRY_DAYS = 7;

/**
 * Plafond d'invitations émises par une organization sur une fenêtre glissante.
 *
 * Sans plafond, n'importe qui crée un compte, une organization, et expédie des
 * milliers d'emails depuis notre domaine. La conséquence ne touche pas que
 * l'abuseur : un domaine signalé fait tomber la délivrabilité de **tous** les
 * emails du système, y compris les réinitialisations de mot de passe.
 */
export const INVITATION_RATE_LIMIT = { count: 50, windowHours: 24 } as const;

/**
 * Longueur du jeton d'invitation, en octets avant encodage. Paramètre de
 * sécurité : 32 octets font 256 bits d'entropie, hors de portée d'une attaque
 * par énumération.
 */
export const INVITATION_TOKEN_BYTES = 32;

/**
 * Longueur du jeton d'une clé API, en octets avant encodage. Même exigence
 * d'entropie que pour une invitation : ces jetons sont des identifiants
 * d'accès à part entière.
 */
export const API_KEY_TOKEN_BYTES = 32;
