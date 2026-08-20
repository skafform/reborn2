import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import { closePool, withContext } from "./client.ts";
import { environments, organizations, projects } from "./schema.ts";

/**
 * Vérifie la propriété qui compte : un locataire ne voit jamais les lignes
 * d'un autre, et ne peut pas en créer chez lui.
 *
 * Ces tests touchent la vraie base locale et n'utilisent **que le rôle
 * applicatif** — aucune connexion privilégiée, y compris pour le nettoyage.
 * `FORCE ROW LEVEL SECURITY` soumet même le propriétaire aux policies, donc un
 * `DELETE` sans contexte ne supprimerait rien de toute façon.
 */
const ACME = "11111111-1111-1111-1111-111111111111";
const GLOBEX = "22222222-2222-2222-2222-222222222222";

/**
 * Drizzle enveloppe l'erreur Postgres ; le code SQLSTATE vit dans `cause`.
 * Le tester est plus précis qu'un message, qui dépend de la locale et de la
 * version.
 */
function pgErrorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code;
}

async function reset() {
  for (const organizationId of [ACME, GLOBEX]) {
    await withContext({ organizationId }, async (tx) => {
      // Ordre imposé par les clés étrangères : `projects` est en RESTRICT.
      await tx.delete(environments);
      await tx.delete(projects);
      await tx.delete(organizations);
    });
  }
}

async function seed() {
  await reset();
  await withContext({ userId: "user-alice" }, (tx) =>
    tx.insert(organizations).values({ id: ACME, name: "Acme" }),
  );
  await withContext({ userId: "user-bob" }, (tx) =>
    tx.insert(organizations).values({ id: GLOBEX, name: "Globex" }),
  );
  await withContext({ organizationId: ACME }, async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({ organizationId: ACME, name: "Site Client A" })
      .returning();
    assert.ok(project);
    await tx.insert(environments).values({ projectId: project.id, name: "master" });
  });
}

describe("isolation multi-tenant", () => {
  after(async () => {
    await reset();
    await closePool();
  });

  it("refuse toute lecture sans contexte", async () => {
    await seed();
    const rows = await withContext({}, (tx) => tx.select().from(organizations));
    assert.equal(rows.length, 0);
  });

  it("refuse la création d'une organization sans utilisateur", async () => {
    await assert.rejects(() =>
      withContext({}, (tx) =>
        tx.insert(organizations).values({ name: "Sans contexte" }),
      ),
    );
  });

  it("ne montre à une organization que ses propres lignes", async () => {
    await seed();

    const acme = await withContext({ organizationId: ACME }, async (tx) => ({
      orgs: await tx.select().from(organizations),
      projects: await tx.select().from(projects),
      environments: await tx.select().from(environments),
    }));
    assert.equal(acme.orgs.length, 1);
    assert.equal(acme.orgs[0]?.name, "Acme");
    assert.equal(acme.projects.length, 1);
    assert.equal(acme.environments.length, 1);

    const globex = await withContext({ organizationId: GLOBEX }, async (tx) => ({
      orgs: await tx.select().from(organizations),
      projects: await tx.select().from(projects),
      environments: await tx.select().from(environments),
    }));
    assert.equal(globex.orgs.length, 1);
    assert.equal(globex.orgs[0]?.name, "Globex");
    assert.equal(globex.projects.length, 0, "ne doit voir aucun projet d'Acme");
    assert.equal(globex.environments.length, 0);
  });

  it("empêche de créer un projet dans une autre organization", async () => {
    await seed();
    await assert.rejects(() =>
      withContext({ organizationId: GLOBEX }, (tx) =>
        tx.insert(projects).values({ organizationId: ACME, name: "Intrusion" }),
      ),
    );
  });

  it("empêche de supprimer une organization qui contient un projet", async () => {
    await seed();
    await assert.rejects(
      () =>
        withContext({ organizationId: ACME }, (tx) =>
          tx.delete(organizations).where(eq(organizations.id, ACME)),
        ),
      (error: unknown) => {
        // 23503 = foreign_key_violation : la règle « vider avant de
        // supprimer » est bien une contrainte de base, pas du code applicatif.
        assert.equal(pgErrorCode(error), "23503");
        return true;
      },
    );
  });

  it("refuse un nom d'environnement invalide", async () => {
    await seed();
    const [project] = await withContext({ organizationId: ACME }, (tx) =>
      tx.select().from(projects),
    );
    assert.ok(project);
    await assert.rejects(() =>
      withContext({ organizationId: ACME }, (tx) =>
        tx.insert(environments).values({ projectId: project.id, name: "Master Prod" }),
      ),
    );
  });

  it("met à jour updated_at automatiquement", async () => {
    await seed();
    const before = await withContext({ organizationId: ACME }, (tx) =>
      tx.select().from(organizations),
    );
    assert.ok(before[0]);

    await withContext({ organizationId: ACME }, async (tx) => {
      await tx.execute(sql`select pg_sleep(0.01)`);
      await tx
        .update(organizations)
        .set({ name: "Acme Corp" })
        .where(eq(organizations.id, ACME));
    });

    const after = await withContext({ organizationId: ACME }, (tx) =>
      tx.select().from(organizations),
    );
    assert.ok(after[0]);
    assert.ok(
      after[0].updatedAt > before[0].updatedAt,
      "le trigger doit avancer updated_at",
    );
  });

  it("pose bien le contexte dans la transaction et l'y confine", async () => {
    const inside = await withContext({ organizationId: ACME }, async (tx) => {
      const result = await tx.execute(sql`select app_current_organization_id() as id`);
      return (result.rows[0] as { id: string | null }).id;
    });
    assert.equal(inside, ACME);

    const outside = await withContext({}, async (tx) => {
      const result = await tx.execute(sql`select app_current_organization_id() as id`);
      return (result.rows[0] as { id: string | null }).id;
    });
    assert.equal(outside, null, "le contexte ne doit pas fuiter entre requêtes");
  });
});
