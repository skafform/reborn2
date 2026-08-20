import { defineConfig } from "drizzle-kit";

/**
 * Les migrations tournent avec le rôle **propriétaire** du schéma, jamais avec
 * le rôle applicatif — celui-ci n'a pas le droit de créer des objets, et c'est
 * voulu (ADR 0003).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations/app",
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? "",
  },
  strict: true,
  verbose: true,
});
