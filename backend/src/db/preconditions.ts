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

/**
 * ⚠️ **Une liste d'exclusion, pas une liste de tables gardées.**
 *
 * Ce contrôle a longtemps énuméré les tables à vérifier. Une liste écrite à la
 * main dérive en silence : cinq tables sous RLS y manquaient — `api_keys`,
 * `invitations`, `project_members`, et les deux du versionnage — donc une
 * `FORCE` perdue sur l'une d'elles aurait laissé le serveur démarrer sans
 * rien dire. C'est exactement la panne que ce fichier existe pour attraper.
 *
 * Inversé, l'oubli change de camp : **toute table de `public` est réputée
 * multi-tenant** et doit être sous RLS activé *et* forcé. Ajouter une table
 * sans ses policies fait refuser le démarrage, ce qui se voit immédiatement.
 *
 * ⚠️ **Le critère d'exclusion, à appliquer avant d'ajouter une cinquième
 * entrée** : une table est exclue si elle n'appartient pas au modèle
 * multi-tenant — c'est-à-dire si elle **n'a pas de colonne de cadrage par
 * conception**, et donc rien sur quoi une policy pourrait porter. Ce n'est pas
 * « les tables d'un autre propriétaire de schéma » ni « celles qu'on n'a pas
 * envie de protéger » : Better-Auth doit lire n'importe quel compte au moment
 * du login, avant qu'aucune session — donc aucun locataire — n'existe.
 *
 * Chaque entrée porte donc sa justification. Une liste d'exclusion dérive
 * aussi ; c'est la justification qui l'en empêche.
 *
 * `drizzle.__drizzle_migrations` n'a pas à y figurer : elle vit hors de
 * `public`, que ce contrôle est seul à examiner.
 */
export const NOT_TENANT_SCOPED: Readonly<Record<string, string>> = {
  user: "Better-Auth doit lire un compte au login, avant toute session",
  session: "portée par un compte, pas par un locataire",
  account: "les identités fédérées d'un compte, hors modèle multi-tenant",
  verification: "jetons éphémères, lus avant qu'un locataire soit connu",
};

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

  /**
   * Toutes les tables ordinaires de `public`, l'exclusion retirée. `relkind`
   * écarte vues et séquences ; `'p'` couvre une table partitionnée, dont il
   * n'existe aucune aujourd'hui mais qui serait autrement invisible ici.
   */
  const { rows: guarded } = await pool.query<{
    relname: string;
    enabled: boolean;
    forced: boolean;
    owned_by_me: boolean;
  }>(
    `SELECT c.relname,
            c.relrowsecurity      AS enabled,
            c.relforcerowsecurity AS forced,
            pg_get_userbyid(c.relowner) = current_user AS owned_by_me
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT (c.relname = ANY($1))
      ORDER BY c.relname`,
    [Object.keys(NOT_TENANT_SCOPED)],
  );

  // ⚠️ Remplaçant du contrôle « table absente » que l'énumération portait :
  // sans lui, une base dont les migrations n'ont jamais tourné passerait tout,
  // n'ayant simplement rien à vérifier.
  if (guarded.length === 0) {
    failures.push({
      check: "tables_exist",
      detail:
        "aucune table applicative dans `public` — les migrations n'ont pas tourné",
    });
  }

  const owned = guarded.filter((row) => row.owned_by_me).map((row) => row.relname);
  if (owned.length > 0) {
    failures.push({
      check: "not_table_owner",
      detail: `le rôle applicatif possède ${owned.join(", ")} — un propriétaire contourne RLS sauf FORCE`,
    });
  }

  for (const table of guarded) {
    // ⚠️ **Les deux, jamais l'un seul.** `FORCE` est précisément ce qu'une
    // migration de données interrompue perd — et sans lui, le propriétaire des
    // tables échappe aux policies. Ne vérifier que l'activation n'attraperait
    // que la moitié de la panne.
    if (table.enabled && table.forced) continue;
    failures.push({
      check: "rls_forced",
      detail: `${table.relname} : ROW LEVEL SECURITY ${table.enabled ? "activé" : "désactivé"}, FORCE ${table.forced ? "activé" : "désactivé"}`,
    });
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
