import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { closePool, unsafePoolForIntrospection } from "./client.ts";
import {
  assertDatabasePreconditions,
  checkDatabasePreconditions,
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
});
