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

  /**
   * Origines admises pour une requête authentifiante, en plus de `baseURL`.
   *
   * Un client servi depuis une autre adresse — une interface d'administration,
   * une application mobile — envoie son propre en-tête `Origin`, que
   * Better-Auth compare à cette liste avant d'ouvrir une session. Elle borne
   * aussi les `callbackURL` de confirmation d'adresse, ce qui empêche de faire
   * rebondir un lien de confirmation vers un site tiers.
   *
   * Le serveur ne nomme aucun client : il lit des adresses de confiance.
   */
  trustedOrigins: env.TRUSTED_ORIGINS,

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

  /**
   * ⚠️ **Set before any OAuth provider exists**, because it is the one setting
   * in this file that grows expensive with time: once accounts are linked,
   * changing it means unlinking them.
   *
   * Without it, Better-Auth implicitly links an OAuth account to a local one
   * with the same address. The condition that might have held that back is
   * **always** met here: linking requires the local address to be verified
   * (`requireLocalEmailVerified`, true by default), and we already impose that
   * on everyone. A misconfigured or compromised provider that accepts a claim
   * to an address would therefore open the matching account.
   *
   * A compromised account here does not expose personal data but **other
   * customers' content**. So linking is explicit: sign in first, link after.
   * See docs/architecture/auth.md.
   */
  account: {
    accountLinking: {
      disableImplicitLinking: true,
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
