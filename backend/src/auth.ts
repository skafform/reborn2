import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { env } from "./config/env.ts";
import { mailer } from "./mail/mailer.ts";
import { render } from "./mail/template.ts";
import { resetPasswordEmail, verifyEmail } from "./mail/templates/auth.ts";

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

    /**
     * Sans cela, n'importe qui crée un compte avec l'adresse d'un tiers et
     * s'en sert — pour recevoir des invitations qui lui étaient destinées,
     * notamment. Un compte non confirmé existe mais ne permet pas de se
     * connecter.
     */
    requireEmailVerification: true,

    sendResetPassword: async ({ user, url }) => {
      await mailer.send({
        ...render(resetPasswordEmail, { resetUrl: url }),
        to: user.email,
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    /** Évite de redemander le mot de passe juste après avoir cliqué. */
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await mailer.send({
        ...render(verifyEmail, { verifyUrl: url }),
        to: user.email,
      });
    },
  },

  /**
   * Le changement d'email est hors périmètre (voir
   * docs/architecture/auth.md) : il ferait diverger les invitations en
   * attente, dont la correspondance d'adresse est stricte.
   */
});
