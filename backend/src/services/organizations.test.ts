import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
/**
 * Ces tests créent de vrais utilisateurs Better-Auth : `organization_members`
 * porte une clé étrangère vers sa table `user`.
 */
import { auth } from "../auth.ts";
import { PERMISSION_KEYS } from "../config/permissions.ts";
import { closePool, withContext } from "../db/client.ts";
import {
  organizationMembers,
  organizations,
  rolePermissions,
  roles,
} from "../db/schema.ts";
import {
  createOrganization,
  listOrganizationsForUser,
  permissionsForMember,
} from "./organizations.ts";

const created: string[] = [];

async function makeUser(email: string): Promise<string> {
  const result = await auth.api.signUpEmail({
    body: { email, password: "MotDePasseTest123!", name: email },
  });
  return result.user.id;
}

async function destroy(organizationId: string, userId: string) {
  // Retirer le dernier owner est interdit ; il faut supprimer l'organization,
  // qui cascade vers ses membres et ses rôles.
  await withContext({ userId, organizationId }, (tx) =>
    tx.delete(organizations).where(eq(organizations.id, organizationId)),
  );
}

describe("createOrganization", () => {
  let alice = "";
  let bob = "";

  before(async () => {
    alice = await makeUser(`alice-${randomUUID()}@skafform.test`);
    bob = await makeUser(`bob-${randomUUID()}@skafform.test`);
  });

  after(async () => {
    for (const id of created) {
      await destroy(id, alice).catch(() => destroy(id, bob).catch(() => {}));
    }
    await closePool();
  });

  it("crée l'organization, ses six rôles système et son owner", async () => {
    const org = await createOrganization({ userId: alice, name: "Acme" });
    created.push(org.id);

    const state = await withContext(
      { userId: alice, organizationId: org.id },
      async (tx) => ({
        roles: await tx.select().from(roles),
        members: await tx.select().from(organizationMembers),
      }),
    );

    assert.equal(state.roles.length, 6);
    assert.ok(
      state.roles.every((role) => role.isSystem),
      "les rôles amorcés sont tous des rôles système",
    );
    assert.deepEqual(
      state.roles
        .filter((r) => r.scope === "organization")
        .map((r) => r.name)
        .sort(),
      ["admin", "owner", "viewer"],
    );
    assert.equal(state.members.length, 1);
    assert.equal(state.members[0]?.userId, alice);
  });

  it("donne au owner l'intégralité du catalogue", async () => {
    const org = await createOrganization({ userId: alice, name: "Perms" });
    created.push(org.id);

    const held = await permissionsForMember(alice, org.id);
    assert.deepEqual(
      held.map((p) => p.key).sort(),
      [...PERMISSION_KEYS].sort(),
      "sans quoi un owner ne pourrait pas accorder ce qu'il ne détient pas",
    );
  });

  it("ne liste que les organizations de l'utilisateur", async () => {
    const acme = await createOrganization({ userId: alice, name: "Chez Alice" });
    const globex = await createOrganization({ userId: bob, name: "Chez Bob" });
    created.push(acme.id, globex.id);

    const forAlice = await listOrganizationsForUser(alice);
    assert.ok(forAlice.some((o) => o.id === acme.id));
    assert.ok(
      !forAlice.some((o) => o.id === globex.id),
      "Alice ne doit pas voir l'organization de Bob",
    );
    assert.equal(forAlice.find((o) => o.id === acme.id)?.role, "owner");
  });

  it("refuse d'assigner à un membre le rôle d'une autre organization", async () => {
    const acme = await createOrganization({ userId: alice, name: "Cible" });
    const globex = await createOrganization({ userId: bob, name: "Source" });
    created.push(acme.id, globex.id);

    const [foreignRole] = await withContext(
      { userId: bob, organizationId: globex.id },
      (tx) => tx.select().from(roles).where(eq(roles.name, "viewer")),
    );
    assert.ok(foreignRole);

    await assert.rejects(
      () =>
        withContext({ userId: alice, organizationId: acme.id }, (tx) =>
          tx.insert(organizationMembers).values({
            organizationId: acme.id,
            userId: bob,
            roleId: foreignRole.id,
          }),
        ),
      "la clé étrangère composite doit rendre l'assignation impossible",
    );
  });

  it("interdit de supprimer un rôle système", async () => {
    const org = await createOrganization({ userId: alice, name: "Systeme" });
    created.push(org.id);

    await assert.rejects(() =>
      withContext({ userId: alice, organizationId: org.id }, (tx) =>
        tx
          .delete(roles)
          .where(and(eq(roles.organizationId, org.id), eq(roles.name, "viewer"))),
      ),
    );
  });

  it("interdit de modifier les permissions d'un rôle système", async () => {
    const org = await createOrganization({ userId: alice, name: "Fige" });
    created.push(org.id);

    // Filtrer sur l'organization est nécessaire : `roles` est lisible pour
    // toutes celles dont l'utilisateur est membre.
    const [viewer] = await withContext(
      { userId: alice, organizationId: org.id },
      (tx) =>
        tx
          .select()
          .from(roles)
          .where(and(eq(roles.organizationId, org.id), eq(roles.name, "viewer"))),
    );
    assert.ok(viewer);

    await assert.rejects(() =>
      withContext({ userId: alice, organizationId: org.id }, (tx) =>
        tx.delete(rolePermissions).where(eq(rolePermissions.roleId, viewer.id)),
      ),
    );
  });

  it("interdit de retirer le dernier owner", async () => {
    const org = await createOrganization({ userId: alice, name: "Dernier" });
    created.push(org.id);

    await assert.rejects(
      () =>
        withContext({ userId: alice, organizationId: org.id }, (tx) =>
          tx.delete(organizationMembers).where(eq(organizationMembers.userId, alice)),
        ),
      "une organization doit toujours conserver un owner",
    );
  });
});
