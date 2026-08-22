import { defineConfig } from "drizzle-kit";

/**
 * Les migrations tournent avec le rôle **propriétaire** du schéma, jamais avec
 * le rôle applicatif — celui-ci n'a pas le droit de créer des objets, et c'est
 * voulu (ADR 0003).
 */
export default defineConfig({
  dialect: "postgresql",
  /**
   * ⚠️ **Deux fichiers, et c'est délibéré.** Le socle porte ses tables, le CMS
   * les siennes (ADR 0019). Ce fichier est hors de `src/`, donc hors de la
   * règle d'import : c'est un point de composition, comme `app.ts`.
   */
  schema: ["./src/db/schema.ts", "./src/cms/schema.ts"],
  out: "./migrations/app",
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? "",
  },
  strict: true,
  verbose: true,
});
