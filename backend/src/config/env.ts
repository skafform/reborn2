import { z } from "zod";

/**
 * Contrat d'environnement. Tout ce qui varie d'un déploiement à l'autre passe
 * ici — les constantes applicatives vivent dans `constants.ts`.
 *
 * La validation a lieu au démarrage : une variable manquante ou malformée fait
 * échouer le lancement avec un message lisible, plutôt qu'un plantage à la
 * première requête.
 */
export const envSchema = z.object({
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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;
