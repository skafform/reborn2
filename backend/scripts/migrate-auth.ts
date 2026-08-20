import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getMigrations } from "better-auth/db/migration";
import { Pool } from "pg";
import { auth } from "../src/auth.ts";
import { env } from "../src/config/env.ts";

/**
 * Migrations des tables de Better-Auth (`user`, `session`, `account`,
 * `verification`).
 *
 * On n'utilise pas `@better-auth/cli` : il épingle `better-auth` en dépendance
 * dure (1.4.x) et génère donc le schéma de *sa* version, pas de celle
 * installée — vérifié, il omettait `account.issuer`. `getMigrations` provient
 * du paquet installé, il ne peut pas dériver.
 *
 * Chaque exécution produisant un changement écrit le SQL compilé dans
 * `migrations/auth/`, versionné avec le code : c'est la trace de ce qui a
 * modifié le schéma d'authentification et quand.
 *
 * Ces migrations tournent avec le rôle propriétaire, et **avant** celles de
 * Drizzle : les clés étrangères applicatives pointent vers `user.id`.
 * Voir docs/architecture/database.md.
 *
 *   pnpm auth:migrate         → écrit le SQL et l'affiche, sans l'exécuter
 *   pnpm auth:migrate:apply   → idem, puis applique
 */
const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
  "auth",
);

const apply = process.argv.includes("--apply");
const pool = new Pool({ connectionString: env.DATABASE_MIGRATION_URL });

const { toBeCreated, toBeAdded, compileMigrations, runMigrations } =
  await getMigrations({ ...auth.options, database: pool });

if (toBeCreated.length === 0 && toBeAdded.length === 0) {
  console.log("Auth schema is up to date.");
  await pool.end();
  process.exit(0);
}

const sql = await compileMigrations();

await mkdir(MIGRATIONS_DIR, { recursive: true });
const existing = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql"));
const next = String(existing.length + 1).padStart(4, "0");
const file = join(MIGRATIONS_DIR, `${next}_auth.sql`);
await writeFile(file, `${sql.trimEnd()}\n`, "utf8");

console.log(sql);
console.log(`-- Written to migrations/auth/${next}_auth.sql`);

if (apply) {
  await runMigrations();
  console.log("-- Applied.");
} else {
  console.log("-- Not applied. Re-run with --apply to execute.");
}

await pool.end();
