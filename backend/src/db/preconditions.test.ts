import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { Pool } from "pg";
import { env } from "../config/env.ts";
import { closePool, unsafePoolForIntrospection } from "./client.ts";
import {
  assertDatabasePreconditions,
  checkDatabasePreconditions,
  NOT_TENANT_SCOPED,
} from "./preconditions.ts";

/**
 * Ce test vaut spécification exécutable : il affirme que la base sur laquelle
 * tourne la suite remplit bien les conditions qui rendent RLS opérante. Sans
 * lui, tous les autres tests d'isolation pourraient passer sur une base où
 * RLS ne s'applique pas du tout.
 */
describe("préconditions de sécurité de la base", () => {
  after(() => closePool());

  it("le rôle applicatif ne contourne pas RLS", async () => {
    const pool = unsafePoolForIntrospection();
    const { rows } = await pool.query<{
      is_superuser: boolean;
      bypasses_rls: boolean;
    }>(
      `SELECT rolsuper AS is_superuser, rolbypassrls AS bypasses_rls
         FROM pg_roles WHERE rolname = current_user`,
    );
    assert.equal(rows[0]?.is_superuser, false);
    assert.equal(rows[0]?.bypasses_rls, false);
  });

  it("ne possède aucune table applicative", async () => {
    const pool = unsafePoolForIntrospection();
    const { rows } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tableowner = current_user`,
    );
    assert.deepEqual(
      rows.map((r) => r.tablename),
      [],
      "un propriétaire contournerait RLS en l'absence de FORCE",
    );
  });

  it("ne relève aucun manquement", async () => {
    const failures = await checkDatabasePreconditions(unsafePoolForIntrospection());
    assert.deepEqual(failures, []);
  });

  it("laisse démarrer le serveur", async () => {
    await assert.doesNotReject(() =>
      assertDatabasePreconditions(unsafePoolForIntrospection()),
    );
  });

  /**
   * ⚠️ **Le contrôle énumérait les tables à vérifier, et la liste avait
   * dérivé** : cinq tables sous RLS y manquaient. Il part maintenant de tout
   * `public` et retire une exclusion justifiée. Ces deux tests éprouvent
   * l'inversion elle-même — sans eux, elle ne serait qu'une réécriture.
   */
  it("n'exclut que des tables sans colonne de cadrage", async () => {
    const { rows } = await unsafePoolForIntrospection().query<{
      relname: string;
    }>(
      `SELECT c.relname
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND NOT c.relrowsecurity
        ORDER BY c.relname`,
    );

    assert.deepEqual(
      rows.map((row) => row.relname),
      Object.keys(NOT_TENANT_SCOPED).sort(),
      "une table de `public` hors RLS qui n'est pas nommée dans l'exclusion est un trou",
    );
  });

  /**
   * La sonde : retirer `FORCE` d'une table que l'ancienne liste ne nommait
   * pas, et vérifier que le contrôle la voit. C'est le seul test qui aurait
   * échoué avant l'inversion.
   *
   * ⚠️ `FORCE` est rétabli dans un `finally`. S'il ne l'était pas, la base
   * resterait avec une table dont le propriétaire échappe aux policies — la
   * panne exacte qu'une migration de données interrompue produit, et que ce
   * contrôle rattrape au démarrage suivant.
   */
  it("voit une `FORCE` perdue sur une table que l'ancienne liste ignorait", async () => {
    const owner = new Pool({ connectionString: env.DATABASE_MIGRATION_URL });
    try {
      await owner.query("ALTER TABLE api_keys NO FORCE ROW LEVEL SECURITY");

      const failures = await checkDatabasePreconditions(unsafePoolForIntrospection());
      assert.deepEqual(
        failures.map((failure) => failure.check),
        ["rls_forced"],
      );
      assert.match(failures[0]?.detail ?? "", /^api_keys .*FORCE désactivé$/);
    } finally {
      await owner.query("ALTER TABLE api_keys FORCE ROW LEVEL SECURITY");
      await owner.end();
    }

    assert.deepEqual(
      await checkDatabasePreconditions(unsafePoolForIntrospection()),
      [],
      "et la base est rendue telle qu'elle était",
    );
  });
});
