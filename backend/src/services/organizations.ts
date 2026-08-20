import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { SYSTEM_ROLES } from "../config/permissions.ts";
import { type Transaction, withContext } from "../db/client.ts";
import {
  environments,
  organizationMembers,
  organizations,
  projects,
  rolePermissions,
  roles,
} from "../db/schema.ts";

/**
 * Crée une organization, ses rôles système, et y inscrit son créateur comme
 * `owner`. Le tout dans une seule transaction : une organization sans rôles,
 * ou sans propriétaire, ne doit jamais exister.
 *
 * L'identifiant est **généré côté applicatif**, pas par la base. C'est ce qui
 * résout l'amorçage : les policies de `roles` et `organization_members`
 * exigent une organization courante, or celle-ci n'existerait pas encore si
 * l'on attendait le `DEFAULT gen_random_uuid()`. En le générant d'abord, le
 * contexte est posé dès l'ouverture de la transaction.
 */
export async function createOrganization(input: {
  userId: string;
  name: string;
}): Promise<{ id: string; name: string }> {
  const id = randomUUID();

  return withContext({ userId: input.userId, organizationId: id }, async (tx) => {
    const [organization] = await tx
      .insert(organizations)
      .values({ id, name: input.name })
      .returning();
    if (!organization) throw new Error("organization insert returned no row");

    const ownerRoleId = await seedSystemRoles(tx, id);

    await tx.insert(organizationMembers).values({
      organizationId: id,
      userId: input.userId,
      roleId: ownerRoleId,
    });

    return { id: organization.id, name: organization.name };
  });
}

/**
 * Copie les rôles système dans l'organization et renvoie l'identifiant de son
 * rôle `owner`. La duplication par organization est ce qui permet à la clé
 * étrangère composite de garantir qu'un membre ne reçoit jamais le rôle d'une
 * autre organization (ADR 0011).
 */
async function seedSystemRoles(
  tx: Transaction,
  organizationId: string,
): Promise<string> {
  const inserted = await tx
    .insert(roles)
    .values(
      SYSTEM_ROLES.map((role) => ({
        organizationId,
        scope: role.scope,
        name: role.name,
        isSystem: true,
      })),
    )
    .returning({ id: roles.id, name: roles.name });

  const byName = new Map(inserted.map((role) => [role.name, role.id]));

  await tx.insert(rolePermissions).values(
    SYSTEM_ROLES.flatMap((role) => {
      const roleId = byName.get(role.name);
      if (!roleId) throw new Error(`role ${role.name} was not inserted`);
      return role.permissions.map((permissionKey) => ({
        roleId,
        permissionKey,
      }));
    }),
  );

  const ownerRoleId = byName.get("owner");
  if (!ownerRoleId) throw new Error("owner role was not created");
  return ownerRoleId;
}

/** Les organizations dont l'utilisateur est membre, avec son rôle. */
export function listOrganizationsForUser(userId: string) {
  return withContext({ userId }, (tx) =>
    tx
      .select({
        id: organizations.id,
        name: organizations.name,
        role: roles.name,
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMembers.organizationId),
      )
      .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
      .where(eq(organizationMembers.userId, userId)),
  );
}

/**
 * Les rôles définis dans une organization — ceux copiés à sa création comme
 * ceux qu'elle a ajoutés depuis.
 *
 * Le `scope` distingue les rôles d'organization de ceux de projet : un rôle de
 * projet ne s'attribue qu'avec un projet, et l'appelant a besoin de le savoir
 * pour ne pas proposer une combinaison que le service refusera.
 */
export function listRoles(userId: string, organizationId: string) {
  return withContext({ userId, organizationId }, (tx) =>
    tx
      .select({
        id: roles.id,
        name: roles.name,
        scope: roles.scope,
        isSystem: roles.isSystem,
      })
      .from(roles)
      .where(eq(roles.organizationId, organizationId)),
  );
}

/** Les permissions détenues par un utilisateur dans une organization. */
export function permissionsForMember(userId: string, organizationId: string) {
  return withContext({ userId, organizationId }, (tx) =>
    tx
      .select({ key: rolePermissions.permissionKey })
      .from(organizationMembers)
      .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(
        and(
          eq(organizationMembers.userId, userId),
          eq(organizationMembers.organizationId, organizationId),
        ),
      ),
  );
}

/** Crée un projet et son environnement `master`, dans la même transaction. */
export async function createProject(input: {
  userId: string;
  organizationId: string;
  name: string;
}): Promise<{ id: string; name: string }> {
  return withContext(
    { userId: input.userId, organizationId: input.organizationId },
    async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({ organizationId: input.organizationId, name: input.name })
        .returning();
      if (!project) throw new Error("project insert returned no row");

      // Un projet sans environnement ne doit jamais exister (ADR 0006).
      await tx.insert(environments).values({
        projectId: project.id,
        organizationId: input.organizationId,
        name: "master",
      });

      return { id: project.id, name: project.name };
    },
  );
}

/** Les projets visibles dans une organization. */
export function listProjects(userId: string, organizationId: string) {
  return withContext({ userId, organizationId }, (tx) =>
    tx
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.organizationId, organizationId)),
  );
}
