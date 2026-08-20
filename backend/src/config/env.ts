import { z } from "zod";

/**
 * Contrat d'environnement. Tout ce qui varie d'un déploiement à l'autre passe
 * ici — les constantes applicatives vivent dans `constants.ts`.
 *
 * La validation a lieu au démarrage : une variable manquante ou malformée fait
 * échouer le lancement avec un message lisible, plutôt qu'un plantage à la
 * première requête.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    PLATFORM_URL: z.url(),

    /** Connexion du serveur : rôle applicatif, soumis aux policies RLS. */
    DATABASE_URL: z.url(),
    /** Connexion des migrations : rôle propriétaire du schéma. */
    DATABASE_MIGRATION_URL: z.url(),

    /** Clé de chiffrement/hachage de Better-Auth. */
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),

    /**
     * Origines autorisées à ouvrir une session, en plus de `BETTER_AUTH_URL`.
     * Séparées par des virgules.
     *
     * Better-Auth compare l'en-tête `Origin` de chaque requête authentifiante
     * à cette liste, et refuse les autres — c'est une protection CSRF, qui
     * vaut aussi pour les `callbackURL` de confirmation d'adresse.
     *
     * Le serveur ne sait pas ce qui se trouve derrière ces origines : il
     * connaît des adresses de confiance, pas des clients. Vide par défaut,
     * donc *fail-closed* — une origine non déclarée est refusée.
     */
    TRUSTED_ORIGINS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url())),

    /**
     * Envoi d'emails. Facultative hors production, où son absence bascule sur
     * un mailer de console — un email perdu en local est sans conséquence, un
     * email perdu en production ne l'est pas.
     */
    RESEND_API_KEY: z.string().min(1).optional(),
    PLATFORM_MAIL_FROM: z.string().min(3),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === "production" && !value.RESEND_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "requise en production",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;
