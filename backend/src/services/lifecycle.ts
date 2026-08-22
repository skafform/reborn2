import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { Actor } from "../auth/authorization.ts";
import { requirePermission } from "../auth/escalation.ts";
import { PERMISSIONS } from "../config/permissions.ts";
import { withContext } from "../db/client.ts";
import {
  apiKeys,
  environments,
  organizationMembers,
  organizations,
  projectMembers,
  projects,
} from "../db/schema.ts";
import { ServiceError } from "./service-error.ts";

/**
 * Settings and deletion of an organization or a project.
 *
 * ⚠️ **Nothing is deleted while it still holds something.** Same rule as an
 * API key, a role, or a membership: emptying is an explicit act, and never a
 * destructive cascade behind one click (architecture/multi-tenant.md).
 *
 * The refusals count what remains, so the answer says what to do next rather
 * than only that it failed.
 *
 * ⚠️ **Four different permissions across this file**, and the split is the
 * point: `org.settings` is the owner's alone, `project.settings` reaches an
 * admin who runs projects, `org.delete` and `project.delete` gate the last
 * act, and `org.billing` stays separate — which is why the billing address is
 * an **optional** field rather than a mandatory one.
 */

export class LifecycleError extends ServiceError {
  declare readonly status: 404 | 409;
}

type Settings = { name: string; description: string };

export async function updateOrganization(input: {
  actor: Actor;
  organizationId: string;
  settings: Settings & {
    /**
     * ⚠️ **Absent means untouched**, and that is what keeps `org.billing`
     * meaningful inside a single request. The console sends the field only
     * when it showed it, which is only when the actor holds the key.
     *
     * The alternative — demanding both permissions for the whole request —
     * would stop a custom role holding `org.settings` alone from saving even
     * a name.
     */
    billingAddress?: string | null | undefined;
  };
}): Promise<{ id: string } & Settings> {
  const { actor, organizationId, settings } = input;
  // ⚠️ Owner only. What belongs to the organization — its name, its billing,
  // its existence — belongs to whoever owns it; delegation goes through a
  // custom role that says so, the same shape as ADR 0014 for `role.manage`.
  requirePermission(actor, PERMISSIONS.orgSettings);

  const { billingAddress, ...rest } = settings;
  const touchesBilling = billingAddress !== undefined;
  if (touchesBilling) requirePermission(actor, PERMISSIONS.orgBilling);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [updated] = await tx
      .update(organizations)
      .set({
        ...rest,
        // Trimmed to `null` rather than kept as an empty string: here the two
        // do differ — "not filled in yet" is not "cleared".
        ...(touchesBilling
          ? { billingAddress: billingAddress?.trim() || null }
          : undefined),
      })
      .where(eq(organizations.id, organizationId))
      .returning({
        id: organizations.id,
        name: organizations.name,
        description: organizations.description,
      });

    if (!updated) throw new LifecycleError(404, "unknown_organization", "introuvable");
    return updated;
  });
}

/**
 * Deletes an organization that holds no project and no member but the caller.
 *
 * ⚠️ The order matters: `projects.organization_id` is `ON DELETE RESTRICT` on
 * purpose, so an organization still holding projects would refuse anyway. The
 * counts turn that refusal into a sentence saying what to empty.
 */
export async function deleteOrganization(input: {
  actor: Actor;
  organizationId: string;
}): Promise<void> {
  const { actor, organizationId } = input;
  requirePermission(actor, PERMISSIONS.orgDelete);

  await withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [remaining] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(eq(projects.organizationId, organizationId));
    if ((remaining?.count ?? 0) > 0) {
      throw new LifecycleError(
        409,
        "has_projects",
        `${remaining?.count} projet(s) à supprimer d'abord`,
      );
    }

    const [others] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          ne(organizationMembers.userId, actor.userId),
        ),
      );
    if ((others?.count ?? 0) > 0) {
      throw new LifecycleError(
        409,
        "has_members",
        `${others?.count} membre(s) à retirer d'abord`,
      );
    }

    await tx.delete(organizations).where(eq(organizations.id, organizationId));
  });
}

/**
 * The billing address is **written** with the rest of the settings, in one
 * request — but **read** here, on its own guarded route.
 *
 * ⚠️ It cannot ride along with `GET /organizations`: that list is readable by
 * every member, and `org.billing` would stop meaning anything. Reading stays
 * guarded like writing, so the key says the same thing in both directions.
 */
export async function readBillingAddress(input: {
  actor: Actor;
  organizationId: string;
}): Promise<{ billingAddress: string | null }> {
  const { actor, organizationId } = input;
  requirePermission(actor, PERMISSIONS.orgBilling);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [found] = await tx
      .select({ billingAddress: organizations.billingAddress })
      .from(organizations)
      .where(eq(organizations.id, organizationId));

    if (!found) throw new LifecycleError(404, "unknown_organization", "introuvable");
    return found;
  });
}

export async function updateProject(input: {
  actor: Actor;
  organizationId: string;
  projectId: string;
  settings: Settings;
}): Promise<{ id: string } & Settings> {
  const { actor, organizationId, projectId, settings } = input;
  // ⚠️ `project.settings`, not `org.settings`. One key used to cover both;
  // when organization settings became owner-only, keeping it would have taken
  // renaming away from the admins who create projects and run them
  // (migration 0027, architecture/roles-permissions.md).
  requirePermission(actor, PERMISSIONS.projectSettings);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [updated] = await tx
      .update(projects)
      .set(settings)
      .where(
        and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)),
      )
      .returning({
        id: projects.id,
        name: projects.name,
        description: projects.description,
      });

    if (!updated) throw new LifecycleError(404, "unknown_project", "introuvable");
    return updated;
  });
}

/**
 * Deletes a project nobody is attached to and no key still opens.
 *
 * ⚠️ **Active API keys block it, which the documented rule did not say.** A
 * project cascades to its environments and then to their keys, so deleting one
 * would kill keys still in circulation — silently, in someone's production
 * site. That is the very thing "revoke before delete" exists to prevent for a
 * single key; a project holding keys is the same situation, larger.
 *
 * Revoked keys do not block: they already open nothing, and they are kept for
 * the trail.
 */
export async function deleteProject(input: {
  actor: Actor;
  organizationId: string;
  projectId: string;
}): Promise<void> {
  const { actor, organizationId, projectId } = input;
  requirePermission(actor, PERMISSIONS.projectDelete);

  await withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)),
      );
    if (!project) throw new LifecycleError(404, "unknown_project", "introuvable");

    const [members] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId));
    if ((members?.count ?? 0) > 0) {
      throw new LifecycleError(
        409,
        "has_members",
        `${members?.count} membre(s) à retirer d'abord`,
      );
    }

    const [active] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(apiKeys)
      .innerJoin(environments, eq(environments.id, apiKeys.environmentId))
      .where(and(eq(environments.projectId, projectId), isNull(apiKeys.revokedAt)));
    if ((active?.count ?? 0) > 0) {
      throw new LifecycleError(
        409,
        "has_active_keys",
        `${active?.count} clé(s) encore active(s) à révoquer d'abord`,
      );
    }

    await tx.delete(projects).where(eq(projects.id, projectId));
  });
}
