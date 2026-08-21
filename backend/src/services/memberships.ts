import { and, eq } from "drizzle-orm";
import type { Actor } from "../auth/authorization.ts";
import { requireCanAssignRole, requireCanManageMember } from "../auth/escalation.ts";
import type { Permission } from "../config/permissions.ts";
import { type Transaction, withContext } from "../db/client.ts";
import {
  organizationMembers,
  projectMembers,
  rolePermissions,
  roles,
} from "../db/schema.ts";
import { ServiceError } from "./service-error.ts";

/**
 * Ce qui met fin à une adhésion, ou la change.
 *
 * ⚠️ **Une adhésion, jamais un compte.** Rien ici ne touche à la table `user` :
 * supprimer le compte de quelqu'un effacerait son accès à sa propre
 * organization personnelle et à toutes les autres où il travaille. C'est une
 * frontière de pouvoir, pas une nuance de vocabulaire
 * (architecture/roles-permissions.md).
 */

export class MembershipError extends ServiceError {
  declare readonly status: 404 | 409;
}

/**
 * Traduit le refus du dernier `owner` en réponse lisible.
 *
 * ⚠️ Le trigger est `DEFERRABLE INITIALLY DEFERRED` : il se déclenche **au
 * commit**, pas à l'instruction. Vérifié — un `.catch()` posé sur le `DELETE`
 * ne voit rien passer, et l'exception ressort ici, autour de la transaction.
 * Sans cette traduction, retirer le dernier propriétaire donnerait un 500.
 */
async function readableLastOwnerRefusal<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    // 23001 — `restrict_violation`, levé par `protect_last_owner`.
    if ((error as { cause?: { code?: string } }).cause?.code === "23001") {
      throw new MembershipError(
        409,
        "last_owner",
        "une organization doit garder au moins un owner actif",
      );
    }
    throw error;
  }
}

/** Le rôle porté par un membre, et de quoi appliquer les garde-fous. */
type MemberRole = { id: string; name: string; isSystem: boolean };

async function organizationMemberRole(
  tx: Transaction,
  organizationId: string,
  userId: string,
): Promise<MemberRole> {
  const [row] = await tx
    .select({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
    .from(organizationMembers)
    .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
      ),
    );
  if (!row) throw new MembershipError(404, "unknown_member", "membre introuvable");
  return row;
}

async function projectMemberRole(
  tx: Transaction,
  projectId: string,
  userId: string,
): Promise<MemberRole> {
  const [row] = await tx
    .select({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
    .from(projectMembers)
    .innerJoin(roles, eq(roles.id, projectMembers.roleId))
    .where(
      and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
    );
  if (!row) throw new MembershipError(404, "unknown_member", "membre introuvable");
  return row;
}

/**
 * Retire quelqu'un d'une organization — ou le laisse partir de lui-même.
 *
 * **Partir ne demande aucune permission.** On n'a pas besoin de `member.manage`
 * pour s'en aller ; la règle du dernier `owner` s'applique quand même, donc le
 * seul propriétaire doit d'abord promouvoir quelqu'un.
 */
export async function removeOrganizationMember(input: {
  actor: Actor;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const { actor, organizationId, userId } = input;

  await readableLastOwnerRefusal(() =>
    withContext({ userId: actor.userId, organizationId }, async (tx) => {
      const role = await organizationMemberRole(tx, organizationId, userId);
      if (userId !== actor.userId) requireCanManageMember(actor, role);

      await tx
        .delete(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, userId),
          ),
        );
    }),
  );
}

/**
 * Suspend ou réactive une adhésion.
 *
 * La ligne subsiste avec son rôle : c'est ce qui rend l'opération réversible
 * sans re-choisir. L'accès cesse parce que la résolution du grant ignore les
 * suspendus, pas parce qu'une permission a été retirée.
 *
 * ⚠️ Se suspendre soi-même n'a pas de sens — on se couperait l'accès sans
 * pouvoir revenir. Refusé, contrairement au départ volontaire.
 */
export async function setOrganizationMemberSuspended(input: {
  actor: Actor;
  organizationId: string;
  userId: string;
  suspended: boolean;
}): Promise<void> {
  const { actor, organizationId, userId, suspended } = input;

  if (userId === actor.userId) {
    throw new MembershipError(
      409,
      "self_suspend",
      "on ne peut pas suspendre sa propre adhésion",
    );
  }

  await readableLastOwnerRefusal(() =>
    withContext({ userId: actor.userId, organizationId }, async (tx) => {
      const role = await organizationMemberRole(tx, organizationId, userId);
      requireCanManageMember(actor, role);

      await tx
        .update(organizationMembers)
        .set({ suspendedAt: suspended ? new Date() : null })
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, userId),
          ),
        );
    }),
  );
}

/**
 * Change le rôle d'un membre.
 *
 * **Deux garde-fous, pas un** : celui du rôle qu'on quitte — un `admin` ne
 * rétrograde pas un `owner` — et celui du rôle qu'on donne, qui est la règle
 * d'escalade complète. Ne vérifier que le second laisserait un `admin`
 * rétrograder le propriétaire vers `viewer`.
 */
export async function changeOrganizationMemberRole(input: {
  actor: Actor;
  organizationId: string;
  userId: string;
  roleId: string;
}): Promise<void> {
  const { actor, organizationId, userId, roleId } = input;

  await readableLastOwnerRefusal(() =>
    withContext({ userId: actor.userId, organizationId }, async (tx) => {
      const current = await organizationMemberRole(tx, organizationId, userId);
      requireCanManageMember(actor, current);

      const target = await assignableRole(tx, organizationId, roleId, "organization");
      requireCanAssignRole(actor, target);

      await tx
        .update(organizationMembers)
        .set({ roleId })
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, userId),
          ),
        );
    }),
  );
}

/** Retire quelqu'un d'un projet, ou le laisse partir. */
export async function removeProjectMember(input: {
  actor: Actor;
  organizationId: string;
  projectId: string;
  userId: string;
}): Promise<void> {
  const { actor, organizationId, projectId, userId } = input;

  await withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const role = await projectMemberRole(tx, projectId, userId);
    if (userId !== actor.userId) requireCanManageMember(actor, role, projectId);

    await tx
      .delete(projectMembers)
      .where(
        and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
      );
  });
}

export async function setProjectMemberSuspended(input: {
  actor: Actor;
  organizationId: string;
  projectId: string;
  userId: string;
  suspended: boolean;
}): Promise<void> {
  const { actor, organizationId, projectId, userId, suspended } = input;

  if (userId === actor.userId) {
    throw new MembershipError(
      409,
      "self_suspend",
      "on ne peut pas suspendre sa propre adhésion",
    );
  }

  await withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const role = await projectMemberRole(tx, projectId, userId);
    requireCanManageMember(actor, role, projectId);

    await tx
      .update(projectMembers)
      .set({ suspendedAt: suspended ? new Date() : null })
      .where(
        and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
      );
  });
}

export async function changeProjectMemberRole(input: {
  actor: Actor;
  organizationId: string;
  projectId: string;
  userId: string;
  roleId: string;
}): Promise<void> {
  const { actor, organizationId, projectId, userId, roleId } = input;

  await withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const current = await projectMemberRole(tx, projectId, userId);
    requireCanManageMember(actor, current, projectId);

    const target = await assignableRole(tx, organizationId, roleId, "project");
    requireCanAssignRole(actor, target);

    await tx
      .update(projectMembers)
      .set({ roleId })
      .where(
        and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
      );
  });
}

/**
 * Le rôle visé, avec ses permissions — de quoi appliquer la règle d'escalade.
 *
 * La **portée doit correspondre** à l'endroit où on l'assigne : un rôle de
 * projet sur une adhésion d'organization vaudrait sur tous les projets. Même
 * défaut que celui corrigé pour les invitations (docs/backlog #0013), et il se
 * reproduirait ici sans ce contrôle.
 */
async function assignableRole(
  tx: Transaction,
  organizationId: string,
  roleId: string,
  scope: "organization" | "project",
) {
  const [role] = await tx
    .select({ name: roles.name, isSystem: roles.isSystem, scope: roles.scope })
    .from(roles)
    .where(and(eq(roles.organizationId, organizationId), eq(roles.id, roleId)));
  if (!role) throw new MembershipError(404, "unknown_role", "rôle introuvable");

  if (role.scope !== scope) {
    throw new MembershipError(
      409,
      "scope_mismatch",
      `un rôle de portée ${role.scope} ne s'attribue pas ici`,
    );
  }

  const granted = await tx
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));

  return {
    name: role.name,
    isSystem: role.isSystem,
    permissions: granted.map((g) => g.key as Permission),
  };
}
