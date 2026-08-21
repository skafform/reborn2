import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { Actor } from "../auth/authorization.ts";
import { requirePermission } from "../auth/escalation.ts";
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
 * Renaming and deleting an organization or a project.
 *
 * ⚠️ **Nothing is deleted while it still holds something.** Same rule as an
 * API key, a role, or a membership: emptying is an explicit act, and never a
 * destructive cascade behind one click (architecture/multi-tenant.md).
 *
 * The refusals count what remains, so the answer says what to do next rather
 * than only that it failed.
 */

export class LifecycleError extends ServiceError {
  declare readonly status: 404 | 409;
}

export async function renameOrganization(input: {
  actor: Actor;
  organizationId: string;
  name: string;
}): Promise<{ id: string; name: string }> {
  const { actor, organizationId, name } = input;
  requirePermission(actor, "org.settings");

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [renamed] = await tx
      .update(organizations)
      .set({ name })
      .where(eq(organizations.id, organizationId))
      .returning({ id: organizations.id, name: organizations.name });

    if (!renamed) throw new LifecycleError(404, "unknown_organization", "introuvable");
    return renamed;
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
  requirePermission(actor, "org.delete");

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

export async function renameProject(input: {
  actor: Actor;
  organizationId: string;
  projectId: string;
  name: string;
}): Promise<{ id: string; name: string }> {
  const { actor, organizationId, projectId, name } = input;
  // `org.settings` covers project settings too — an admin holds it, and there
  // is no separate project-settings permission (architecture/roles-permissions.md).
  requirePermission(actor, "org.settings");

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [renamed] = await tx
      .update(projects)
      .set({ name })
      .where(
        and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)),
      )
      .returning({ id: projects.id, name: projects.name });

    if (!renamed) throw new LifecycleError(404, "unknown_project", "introuvable");
    return renamed;
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
  requirePermission(actor, "project.delete");

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
