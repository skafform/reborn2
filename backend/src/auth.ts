import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { env } from "./config/env.ts";

/**
 * Better-Auth possède ses propres tables (`user`, `session`, `account`,
 * `verification`) et y accède par un `pg.Pool` direct — jamais via Drizzle,
 * dont l'adapter a des bugs de compatibilité documentés.
 * Voir docs/architecture/database.md.
 *
 * Le pool utilise `DATABASE_URL`, donc le rôle applicatif : ces tables ne sont
 * pas soumises à RLS, mais le serveur ne se connecte jamais en propriétaire.
 */
const pool = new Pool({ connectionString: env.DATABASE_URL });

export const auth = betterAuth({
  database: pool,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    // Écart assumé et suivi : docs/backlog #0001. Levé dès que l'envoi
    // d'emails existe. Bloquant avant toute mise en ligne.
    requireEmailVerification: false,
  },
});
