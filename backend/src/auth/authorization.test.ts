import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { auth } from "../auth.ts";
import { PERMISSIONS, permissionKeys } from "../config/permissions.ts";
import { closePool, withContext } from "../db/client.ts";
import {
  organizationMembers,
  projectMembers,
  rolePermissions,
  roles,
} from "../db/schema.ts";
import { createOrganization, createProject } from "../services/organizations.ts";
import { destroyOrganization, destroyUsers } from "../test-support/cleanup.ts";
import { can, resolveActor } from "./authorization.ts";
import {
  AuthorizationError,
  requireCanAssignRole,
  requireCanDefineRole,
  requirePermission,
} from "./escalation.ts";

const created: { organizationId: string; ownerId: string }[] = [];
const createdUsers: string[] = [];

async function makeUser(prefix: string): Promise<string> {
  const result = await auth.api.signUpEmail({
    body: {
      email: `${prefix}-${randomUUID()}@skafform.test`,
      password: "MotDePasseTest123!",
      name: prefix,
    },
  });
  createdUsers.push(result.user.id);
  return result.user.id;
}

/** Assigne un rôle système existant de l'organization à un utilisateur. */
async function addMember(
  organizationId: string,
  ownerId: string,
  userId: string,
  roleName: string,
) {
  await withContext({ userId: ownerId, organizationId }, async (tx) => {
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.name, roleName)));
    assert.ok(role, `rôle ${roleName} introuvable`);
    await tx
      .insert(organizationMembers)
      .values({ organizationId, userId, roleId: role.id });
  });
}

/**
 * Creates a custom role — what an owner does to delegate. Written directly
 * rather than through a service, since none exists yet.
 */
async function customRole(
  organizationId: string,
  ownerId: string,
  name: string,
  permissions: readonly string[],
): Promise<string> {
  return withContext({ userId: ownerId, organizationId }, async (tx) => {
    const [role] = await tx
      .insert(roles)
      .values({ organizationId, scope: "organization", name, isSystem: false })
      .returning({ id: roles.id });
    assert.ok(role);
    await tx
      .insert(rolePermissions)
      .values(permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })));
    return role.id;
  });
}

/** Assigns an existing role by id, system or not. */
async function addMemberWithRole(
  organizationId: string,
  ownerId: string,
  userId: string,
  roleId: string,
) {
  await withContext({ userId: ownerId, organizationId }, (tx) =>
    tx.insert(organizationMembers).values({ organizationId, userId, roleId }),
  );
}

async function addProjectMember(
  organizationId: string,
  ownerId: string,
  projectId: string,
  userId: string,
  roleName: string,
) {
  await withContext({ userId: ownerId, organizationId }, async (tx) => {
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.name, roleName)));
    assert.ok(role);
    await tx
      .insert(projectMembers)
      .values({ projectId, organizationId, userId, roleId: role.id });
  });
}

describe("autorisation", () => {
  let owner = "";
  let viewer = "";
  let outsider = "";
  let organizationId = "";
  let projectId = "";

  before(async () => {
    owner = await makeUser("owner");
    viewer = await makeUser("viewer");
    outsider = await makeUser("outsider");

    const organization = await createOrganization({
      userId: owner,
      name: "Acme",
    });
    organizationId = organization.id;
    created.push({ organizationId, ownerId: owner });

    await addMember(organizationId, owner, viewer, "viewer");
    const project = await createProject({
      userId: owner,
      organizationId,
      name: "Site",
    });
    projectId = project.id;
  });

  after(async () => {
    for (const { organizationId: id, ownerId } of created) {
      await destroyOrganization(ownerId, id);
    }
    await destroyUsers(createdUsers);
    await closePool();
  });

  describe("résolution", () => {
    it("donne au owner tout le catalogue, sur toute l'organization", async () => {
      const actor = await resolveActor(owner, organizationId);
      assert.equal(actor.grant?.scope, "organization");
      assert.equal(actor.grant?.permissions.size, permissionKeys().length);
    });

    it("ne rattache pas un étranger à l'organization", async () => {
      const actor = await resolveActor(outsider, organizationId);
      assert.equal(
        actor.grant,
        null,
        "sans rattachement, le middleware répond 404 et ne confirme pas l'existence",
      );
    });
  });

  describe("can()", () => {
    it("laisse le owner écrire et publier", async () => {
      const actor = await resolveActor(owner, organizationId);
      assert.equal(can(actor, PERMISSIONS.contentWrite), true);
      assert.equal(can(actor, PERMISSIONS.contentPublish), true);
      assert.equal(can(actor, PERMISSIONS.orgDelete), true);
    });

    it("empêche un viewer d'écrire", async () => {
      const actor = await resolveActor(viewer, organizationId);
      assert.equal(can(actor, PERMISSIONS.contentRead), true);
      assert.equal(can(actor, PERMISSIONS.contentReadDraft), true);
      assert.equal(can(actor, PERMISSIONS.contentWrite), false);
      assert.equal(can(actor, PERMISSIONS.contentPublish), false);
      assert.equal(can(actor, PERMISSIONS.projectCreate), false);
      assert.equal(can(actor, PERMISSIONS.orgSettings), false);
    });

    it("refuse tout à un acteur sans rattachement", async () => {
      const actor = await resolveActor(outsider, organizationId);
      for (const permission of permissionKeys()) {
        assert.equal(can(actor, permission), false, permission);
      }
    });
  });

  describe("portée d'un membre de projet", () => {
    let contributor = "";
    let otherProjectId = "";

    before(async () => {
      contributor = await makeUser("contributor");
      await addProjectMember(
        organizationId,
        owner,
        projectId,
        contributor,
        "contributor",
      );
      const other = await createProject({
        userId: owner,
        organizationId,
        name: "Autre",
      });
      otherProjectId = other.id;
    });

    it("accorde ses droits dans le projet assigné", async () => {
      const actor = await resolveActor(contributor, organizationId);
      assert.equal(actor.grant?.scope, "project");
      assert.equal(can(actor, PERMISSIONS.contentWrite, projectId), true);
      assert.equal(
        can(actor, PERMISSIONS.contentPublish, projectId),
        false,
        "un contributor ne publie pas",
      );
    });

    it("les refuse dans un autre projet de la même organization", async () => {
      const actor = await resolveActor(contributor, organizationId);
      assert.equal(can(actor, PERMISSIONS.contentWrite, otherProjectId), false);
    });

    it("les refuse pour une action portant sur l'organization entière", async () => {
      const actor = await resolveActor(contributor, organizationId);
      assert.equal(
        can(actor, PERMISSIONS.contentWrite),
        false,
        "sans projet cible, l'action vise l'organization",
      );
    });
  });

  describe("garde-fous d'escalade", () => {
    it("empêche d'accorder une permission non détenue", async () => {
      const actor = await resolveActor(viewer, organizationId);
      assert.throws(
        () => requireCanDefineRole(actor, [PERMISSIONS.orgDelete]),
        (error: unknown) => {
          assert.ok(error instanceof AuthorizationError);
          assert.equal(error.status, 403);
          return true;
        },
      );
    });

    /**
     * An admin can no longer define roles at all (ADR 0014), so the attack the
     * escalation rule was written against is now stopped one step earlier.
     * Both refusals matter, and they are not the same one — this pins which is
     * which.
     */
    it("stops an admin before the escalation rule even applies", async () => {
      const admin = await makeUser("admin");
      await addMember(organizationId, owner, admin, "admin");
      const actor = await resolveActor(admin, organizationId);

      assert.equal(
        can(actor, PERMISSIONS.roleManage),
        false,
        "role creation is owner-only",
      );
      assert.throws(
        () => requireCanDefineRole(actor, [PERMISSIONS.contentWrite]),
        /role\.manage/,
        "refused for lacking role.manage, not for over-granting",
      );
    });

    /**
     * The escalation rule still has a subject: whoever the owner delegates to.
     * A custom role carrying role.manage lets its holder define roles, never
     * beyond what they hold themselves — which is what keeps the ceiling at
     * every level of delegation.
     */
    it("keeps a delegate inside what they hold", async () => {
      const delegate = await makeUser("delegate");
      const roleId = await customRole(organizationId, owner, "role-keeper", [
        PERMISSIONS.roleManage,
        PERMISSIONS.contentWrite,
      ]);
      await addMemberWithRole(organizationId, owner, delegate, roleId);
      const actor = await resolveActor(delegate, organizationId);

      assert.doesNotThrow(() =>
        requireCanDefineRole(actor, [PERMISSIONS.contentWrite]),
      );
      assert.throws(
        () =>
          requireCanDefineRole(actor, [
            PERMISSIONS.contentWrite,
            PERMISSIONS.orgDelete,
          ]),
        /org\.delete/,
        "a delegate cannot grant beyond the delegation",
      );
    });

    it("laisse le owner définir un rôle avec ce qu'il détient", async () => {
      const actor = await resolveActor(owner, organizationId);
      assert.doesNotThrow(() =>
        requireCanDefineRole(actor, [
          PERMISSIONS.contentRead,
          PERMISSIONS.contentWrite,
        ]),
      );
    });

    it("réserve l'assignation d'un rôle privilégié au owner", async () => {
      const admin = await resolveActor(
        await (async () => {
          const id = await makeUser("admin2");
          await addMember(organizationId, owner, id, "admin");
          return id;
        })(),
        organizationId,
      );

      assert.throws(
        () =>
          requireCanAssignRole(admin, {
            name: "admin",
            isSystem: true,
            permissions: [PERMISSIONS.contentRead],
          }),
        /member\.manage_admin/,
      );

      assert.doesNotThrow(
        () =>
          requireCanAssignRole(admin, {
            name: "viewer",
            isSystem: true,
            permissions: [PERMISSIONS.contentRead],
          }),
        "un admin assigne bien les rôles non privilégiés",
      );
    });
  });

  describe("requirePermission", () => {
    it("échoue en 403 quand la ressource est visible mais l'action interdite", async () => {
      const actor = await resolveActor(viewer, organizationId);
      assert.throws(
        () => requirePermission(actor, PERMISSIONS.contentWrite),
        (error: unknown) => {
          assert.ok(error instanceof AuthorizationError);
          assert.equal(error.status, 403);
          assert.equal(error.reason, "missing_permission");
          return true;
        },
      );
    });
  });
});
