import { and, eq, sql } from "drizzle-orm";
import type { Actor } from "../auth/authorization.ts";
import { requireCanDefineRole } from "../auth/escalation.ts";
import type { Permission, RoleScope } from "../config/permissions.ts";
import { type Transaction, withContext } from "../db/client.ts";
import {
  organizationMembers,
  projectMembers,
  rolePermissions,
  roles,
} from "../db/schema.ts";
import { ServiceError } from "./service-error.ts";

/**
 * Custom roles.
 *
 * The permission catalogue stays in code; what a role *means* lives in the
 * database, one copy per organization (ADR 0011). Only an owner can write
 * here — an admin assigns the roles that exist (ADR 0014).
 *
 * ⚠️ Every write goes through `requireCanDefineRole`, which checks
 * `role.manage` **and** the escalation rule. Skipping the second would let
 * someone mint a role more powerful than themselves and assign it to
 * themselves.
 */

export class RoleError extends ServiceError {
  declare readonly status: 404 | 409;
}

/** A system role is read-only, and its name is what the guards key on. */
async function editableRole(tx: Transaction, organizationId: string, roleId: string) {
  const [role] = await tx
    .select({ name: roles.name, scope: roles.scope, isSystem: roles.isSystem })
    .from(roles)
    .where(and(eq(roles.organizationId, organizationId), eq(roles.id, roleId)));

  if (!role) throw new RoleError(404, "unknown_role", "rôle introuvable");
  if (role.isSystem) {
    throw new RoleError(
      409,
      "system_role",
      "un rôle système ne se modifie ni ne se supprime",
    );
  }
  return role;
}

/**
 * Turns the unique constraint on (organization, scope, name) into a readable
 * refusal. Two roles of the same scope cannot share a name, and finding out by
 * a 500 helps nobody.
 */
async function readableDuplicateName<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === "23505") {
      throw new RoleError(409, "duplicate_name", "un rôle porte déjà ce nom");
    }
    throw error;
  }
}

/** Replaces a role's permissions wholesale — the set is the role. */
async function setPermissions(
  tx: Transaction,
  roleId: string,
  permissions: readonly Permission[],
) {
  await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (permissions.length > 0) {
    await tx
      .insert(rolePermissions)
      .values(permissions.map((permissionKey) => ({ roleId, permissionKey })));
  }
}

export async function createRole(input: {
  actor: Actor;
  organizationId: string;
  scope: RoleScope;
  name: string;
  permissions: readonly Permission[];
}): Promise<{ id: string }> {
  const { actor, organizationId, scope, name, permissions } = input;
  requireCanDefineRole(actor, permissions);

  return readableDuplicateName(() =>
    withContext({ userId: actor.userId, organizationId }, async (tx) => {
      const [created] = await tx
        .insert(roles)
        .values({ organizationId, scope, name, isSystem: false })
        .returning({ id: roles.id });
      if (!created) throw new Error("role insert returned no row");

      await setPermissions(tx, created.id, permissions);
      return { id: created.id };
    }),
  );
}

/**
 * Renames a role and replaces its permissions.
 *
 * ⚠️ **This changes what every holder can do, from their next request on.**
 * Permissions are resolved per request with no cache (ADR 0012) — which is
 * what makes a removal take effect immediately, and why the screen shows the
 * holder count before saving.
 */
export async function updateRole(input: {
  actor: Actor;
  organizationId: string;
  roleId: string;
  name: string;
  permissions: readonly Permission[];
}): Promise<void> {
  const { actor, organizationId, roleId, name, permissions } = input;
  requireCanDefineRole(actor, permissions);

  await readableDuplicateName(() =>
    withContext({ userId: actor.userId, organizationId }, async (tx) => {
      await editableRole(tx, organizationId, roleId);

      await tx.update(roles).set({ name }).where(eq(roles.id, roleId));
      await setPermissions(tx, roleId, permissions);
    }),
  );
}

/**
 * Deletes a role nobody holds.
 *
 * ⚠️ **A held role is not deleted, it is emptied first.** Same rule as an
 * organization or a project — nothing disappears while something still points
 * at it, and never a destructive cascade behind one click. The composite
 * foreign key would refuse anyway; counting first turns that into a sentence
 * that says how many people to reassign.
 */
export async function deleteRole(input: {
  actor: Actor;
  organizationId: string;
  roleId: string;
}): Promise<void> {
  const { actor, organizationId, roleId } = input;
  requireCanDefineRole(actor, []);

  await withContext({ userId: actor.userId, organizationId }, async (tx) => {
    await editableRole(tx, organizationId, roleId);

    const holders = await countHolders(tx, roleId);
    if (holders > 0) {
      throw new RoleError(
        409,
        "role_in_use",
        `${holders} membre(s) portent encore ce rôle`,
      );
    }

    await tx.delete(roles).where(eq(roles.id, roleId));
  });
}

/** Holders across both membership tables — a role can be worn at either level. */
async function countHolders(tx: Transaction, roleId: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(organizationMembers)
    .where(eq(organizationMembers.roleId, roleId));
  const [project] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(projectMembers)
    .where(eq(projectMembers.roleId, roleId));

  return (row?.count ?? 0) + (project?.count ?? 0);
}

/**
 * How many people wear each role of an organization.
 *
 * One query rather than one per role: the screen shows the count next to every
 * row, and a role list is short but not worth N round trips.
 */
export function countHoldersByRole(userId: string, organizationId: string) {
  return withContext({ userId, organizationId }, async (tx) => {
    const rows = await tx
      .select({ roleId: organizationMembers.roleId, count: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationId))
      .groupBy(organizationMembers.roleId)
      // ⚠️ `unionAll`, not `union`. A role can be worn at both levels, and
      // `union` deduplicates identical rows — three holders on each side would
      // have collapsed into one and counted three instead of six.
      .unionAll(
        tx
          .select({ roleId: projectMembers.roleId, count: sql<number>`count(*)::int` })
          .from(projectMembers)
          .where(eq(projectMembers.organizationId, organizationId))
          .groupBy(projectMembers.roleId),
      );

    const byRole = new Map<string, number>();
    for (const row of rows) {
      byRole.set(row.roleId, (byRole.get(row.roleId) ?? 0) + row.count);
    }
    return byRole;
  });
}
