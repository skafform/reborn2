import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { union } from "drizzle-orm/pg-core";
import { type Actor, can } from "../auth/authorization.ts";
import { type Permission, SYSTEM_ROLES } from "../config/permissions.ts";
import { type Transaction, withContext } from "../db/client.ts";
import {
  environments,
  organizationMembers,
  organizations,
  projectMembers,
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

/**
 * Les organizations de quelqu'un — la sienne, et celles qui l'hébergent.
 *
 * **Deux appartenances, pas une.** Sans le nom du rôle : il n'aurait pas de
 * sens pour un membre de projet, dont le rôle vit sur le projet et peut
 * différer de l'un à l'autre. Ce qu'on peut faire se demande à `/me`.
 */
export function listOrganizationsForUser(userId: string) {
  return withContext({ userId }, (tx) =>
    union(
      tx
        .select({ id: organizations.id, name: organizations.name })
        .from(organizationMembers)
        .innerJoin(
          organizations,
          eq(organizations.id, organizationMembers.organizationId),
        )
        // Une adhésion suspendue ne compte pas : l'organization disparaît du
        // sélecteur, comme elle a disparu de la résolution du grant. La laisser
        // afficherait un nom derrière lequel tout répond 404.
        .where(
          and(
            eq(organizationMembers.userId, userId),
            isNull(organizationMembers.suspendedAt),
          ),
        ),
      // Un membre de projet n'a aucune ligne dans `organization_members` — il
      // reste extérieur à l'organization. Elle doit pourtant apparaître dans
      // son sélecteur, sans quoi son projet est inatteignable
      // (architecture/multi-tenant.md).
      tx
        .select({ id: organizations.id, name: organizations.name })
        .from(projectMembers)
        .innerJoin(organizations, eq(organizations.id, projectMembers.organizationId))
        .where(
          and(eq(projectMembers.userId, userId), isNull(projectMembers.suspendedAt)),
        ),
    )
      // `union` dédoublonne : trois projets dans la même organization n'y
      // font qu'une entrée.
      //
      // L'ordre est explicite parce que la racine de la console entre dans la
      // **première** — sans `order by`, une union ne promet aucun ordre, et
      // l'organization d'arrivée pourrait changer d'une visite à l'autre.
      .orderBy(sql`name`),
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
export async function listRoles(userId: string, organizationId: string) {
  const rows = await withContext({ userId, organizationId }, (tx) =>
    tx
      .select({
        id: roles.id,
        name: roles.name,
        scope: roles.scope,
        isSystem: roles.isSystem,
        permissionKey: rolePermissions.permissionKey,
      })
      .from(roles)
      // `left` et non `inner` : un rôle personnalisé sans aucune permission est
      // légitime, et une jointure interne le ferait disparaître de la liste.
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(eq(roles.organizationId, organizationId)),
  );

  /**
   * Une ligne par permission en base, un objet par rôle en sortie. Les
   * permissions servent à décider ce que l'appelant peut assigner
   * (`canAssignRole`) — elles ne sortent pas de l'API pour autant, la route
   * n'en expose que le verdict.
   */
  const byRole = new Map<string, Role>();
  for (const row of rows) {
    const role = byRole.get(row.id) ?? {
      id: row.id,
      name: row.name,
      scope: row.scope,
      isSystem: row.isSystem,
      permissions: [] as Permission[],
    };
    if (row.permissionKey) role.permissions.push(row.permissionKey as Permission);
    byRole.set(row.id, role);
  }
  return [...byRole.values()];
}

type Role = {
  id: string;
  name: string;
  scope: "organization" | "project";
  isSystem: boolean;
  permissions: Permission[];
};

/**
 * Les membres d'une organization, avec leur rôle.
 *
 * L'adresse et le nom viennent de `"user"`, qui appartient à Better-Auth et
 * n'est pas déclarée dans le schéma Drizzle (ADR 0002) — d'où la jointure en
 * SQL. `user` est un mot réservé, d'où les guillemets.
 *
 * Les membres de projet ne sont **pas** inclus : ils n'appartiennent pas à
 * l'organization (architecture/invitations.md), et les confondre ici ferait
 * croire l'inverse.
 */
export function listMembers(userId: string, organizationId: string) {
  return withContext({ userId, organizationId }, (tx) =>
    tx
      .select({
        userId: organizationMembers.userId,
        roleId: organizationMembers.roleId,
        roleName: roles.name,
        // La console ne peut pas décider qui elle a le droit de retirer : ça
        // demanderait de comparer les rôles, donc de recopier la matrice RBAC.
        // L'appelant reçoit de quoi appliquer le garde-fou, jamais le nom seul.
        roleIsSystem: roles.isSystem,
        suspendedAt: organizationMembers.suspendedAt,
        name: sql<string>`u.name`,
        email: sql<string>`u.email`,
        joinedAt: organizationMembers.createdAt,
      })
      .from(organizationMembers)
      .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
      .innerJoin(sql`"user" u`, sql`u.id = ${organizationMembers.userId}`)
      .where(eq(organizationMembers.organizationId, organizationId)),
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

/**
 * Les projets qu'un acteur peut lire dans une organization.
 *
 * **On voit les projets que sa portée atteint** — une seule règle, exprimée par
 * `can()`, l'unique autorité d'autorisation. Une portée organization les
 * atteint tous ; une portée projet, ceux où l'on est membre.
 *
 * ⚠️ Le filtrage n'est **pas** une policy RLS. Une fois le contexte posé sur
 * l'organization, toutes ses lignes franchissent la frontière de locataire —
 * c'est le rôle de RLS et rien de plus. Restreindre à ses projets est une
 * décision de rôles, donc applicative ([securite.md](../../../docs/architecture/securite.md)).
 */
export async function listProjects(actor: Actor, organizationId: string) {
  const rows = await withContext({ userId: actor.userId, organizationId }, (tx) =>
    tx
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.organizationId, organizationId)),
  );
  return rows.filter((project) => can(actor, "content.read", project.id));
}

/**
 * Un projet précis, si l'acteur peut le lire. `null` sinon — l'appelant en
 * fait un 404 : un projet qu'on ne peut pas voir est indiscernable d'un projet
 * qui n'existe pas (ADR 0012).
 */
export async function findProject(
  actor: Actor,
  organizationId: string,
  projectId: string,
) {
  const [project] = await withContext({ userId: actor.userId, organizationId }, (tx) =>
    tx
      .select({ id: projects.id, name: projects.name, createdAt: projects.createdAt })
      .from(projects)
      .where(
        and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)),
      ),
  );
  if (!project) return null;
  return can(actor, "content.read", project.id) ? project : null;
}

/**
 * Les membres d'un projet. Même forme que `listMembers`, et même raison de
 * passer par du SQL pour `"user"` : la table appartient à Better-Auth.
 */
export function listProjectMembers(
  userId: string,
  organizationId: string,
  projectId: string,
) {
  return withContext({ userId, organizationId }, (tx) =>
    tx
      .select({
        userId: projectMembers.userId,
        roleId: projectMembers.roleId,
        roleName: roles.name,
        roleIsSystem: roles.isSystem,
        suspendedAt: projectMembers.suspendedAt,
        name: sql<string>`u.name`,
        email: sql<string>`u.email`,
        joinedAt: projectMembers.createdAt,
      })
      .from(projectMembers)
      .innerJoin(roles, eq(roles.id, projectMembers.roleId))
      .innerJoin(sql`"user" u`, sql`u.id = ${projectMembers.userId}`)
      .where(eq(projectMembers.projectId, projectId)),
  );
}
