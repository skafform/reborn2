import type { Config } from "@react-router/dev/config";

/**
 * Pas de rendu serveur.
 *
 * La session est un cookie que le navigateur détient et envoie à l'API. Un
 * rendu serveur imposerait un serveur intermédiaire à qui relayer ce cookie,
 * puis qui le relaierait à l'API — un saut de plus pour aucun gain : cette
 * interface est derrière une authentification, sans besoin de référencement,
 * et ses données sont propres à chaque utilisateur.
 */
export default { ssr: false } satisfies Config;
