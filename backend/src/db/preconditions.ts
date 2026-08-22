import type { Pool } from "pg";

/**
 * Préconditions de sécurité de la base.
 *
 * Une configuration *absente* échoue bruyamment ; une configuration *fausse*
 * ne fait aucun bruit. Si l'application se connecte avec un rôle superuser ou
 * propriétaire des tables, RLS devient inerte : tout fonctionne, les tests
 * passent, et chaque locataire voit les données de tous les autres.
 *
 * Ce contrôle transforme ce silence en refus de démarrage. Il vaut quelle que
 * soit la façon dont la base a été mise en place — script d'amorçage, console
 * d'un hébergeur, ou à la main.
 *
 * Voir ADR 0003 et docs/architecture/database.md.
 */

/** Tables applicatives : elles doivent toutes être sous RLS activé et forcé. */
const GUARDED_TABLES = [
  "organizations",
  "projects",
  "environments",
  "permissions",
  "roles",
  "role_permissions",
  "organization_members",
  "schemas",
] as const;

export type PreconditionFailure = { check: string; detail: string };

export async function checkDatabasePreconditions(
  pool: Pool,
): Promise<PreconditionFailure[]> {
  const failures: PreconditionFailure[] = [];

  const { rows: identity } = await pool.query<{
    role: string;
    is_superuser: boolean;
    bypasses_rls: boolean;
  }>(
    `SELECT current_user AS role,
            rolsuper     AS is_superuser,
            rolbypassrls AS bypasses_rls
       FROM pg_roles WHERE rolname = current_user`,
  );

  const me = identity[0];
  if (!me) {
    return [{ check: "identity", detail: "current_user introuvable dans pg_roles" }];
  }

  if (me.is_superuser) {
    failures.push({
      check: "not_superuser",
      detail: `le rôle applicatif « ${me.role} » est superuser — RLS ne s'appliquerait pas`,
    });
  }
  if (me.bypasses_rls) {
    failures.push({
      check: "no_bypassrls",
      detail: `le rôle applicatif « ${me.role} » porte BYPASSRLS`,
    });
  }

  const { rows: owned } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tableowner = current_user
        AND tablename = ANY($1)`,
    [GUARDED_TABLES],
  );
  if (owned.length > 0) {
    failures.push({
      check: "not_table_owner",
      detail: `le rôle applicatif possède ${owned.map((r) => r.tablename).join(", ")} — un propriétaire contourne RLS sauf FORCE`,
    });
  }

  const { rows: guarded } = await pool.query<{
    relname: string;
    enabled: boolean;
    forced: boolean;
  }>(
    `SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1)`,
    [GUARDED_TABLES],
  );

  const seen = new Map(guarded.map((row) => [row.relname, row]));
  for (const table of GUARDED_TABLES) {
    const row = seen.get(table);
    if (!row) {
      failures.push({ check: "table_exists", detail: `table absente : ${table}` });
    } else if (!row.enabled || !row.forced) {
      failures.push({
        check: "rls_forced",
        detail: `${table} : ROW LEVEL SECURITY ${row.enabled ? "activé" : "désactivé"}, FORCE ${row.forced ? "activé" : "désactivé"}`,
      });
    }
  }

  return failures;
}

/** Lève si une précondition n'est pas remplie. À appeler au démarrage. */
export async function assertDatabasePreconditions(pool: Pool): Promise<void> {
  const failures = await checkDatabasePreconditions(pool);
  if (failures.length === 0) return;

  const details = failures.map((f) => `  - ${f.check}: ${f.detail}`).join("\n");
  throw new Error(
    `Database security preconditions not met:\n${details}\n` +
      "Voir docs/architecture/database.md, section « Provisionnement d'un environnement ».",
  );
}
