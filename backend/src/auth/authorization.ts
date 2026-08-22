import { and, eq, isNull } from "drizzle-orm";
import type { Permission } from "../config/permissions.ts";
import { type Transaction, withContext } from "../db/client.ts";
import {
  organizationMembers,
  projectMembers,
  rolePermissions,
  roles,
} from "../db/schema.ts";

/**
 * Résolution des permissions et point de vérification unique.
 *
 * Les permissions sont lues **une seule fois par requête** puis conservées en
 * mémoire pour sa durée : `can()` n'accède jamais à la base. Aucun cache ne
 * survit à la requête, ce qui fait qu'un retrait de rôle prend effet à la
 * requête suivante sans invalidation à orchestrer — et qu'aucune clé de cache
 * mal composée ne peut faire fuiter des accès entre organizations.
 *
 * Voir ADR 0012.
 */

/** Ce qu'un acteur peut faire dans une organization donnée. */
export type Grant = {
  organizationId: string;
  /** Rattachement direct à l'organization, ou seulement à certains projets. */
  scope: "organization" | "project";
  /** Projets couverts. Vide quand la portée est l'organization entière. */
  projectIds: readonly string[];
  permissions: ReadonlySet<Permission>;
};

export type Actor = {
  userId: string;
  /** `null` quand l'acteur n'a aucun accès à cette organization. */
  grant: Grant | null;
};

/**
 * Charge en une requête l'appartenance et les permissions d'un utilisateur
 * dans une organization.
 *
 * Un rôle d'organization couvre tous ses projets ; un rôle de projet ne couvre
 * que les projets assignés. Les deux ne se cumulent pas
 * (architecture/roles-permissions.md), mais si un cumul survenait malgré tout,
 * c'est la portée la plus large qui l'emporte — filet de sécurité, pas
 * comportement attendu.
 */
export async function resolveActor(
  userId: string,
  organizationId: string,
): Promise<Actor> {
  const grant = await withContext({ userId, organizationId }, async (tx) => {
    const fromOrganization = await organizationGrant(tx, userId, organizationId);
    if (fromOrganization) return fromOrganization;
    return projectGrant(tx, userId, organizationId);
  });

  return { userId, grant };
}

async function organizationGrant(
  tx: Transaction,
  userId: string,
  organizationId: string,
): Promise<Grant | null> {
  const rows = await tx
    .select({ permission: rolePermissions.permissionKey })
    .from(organizationMembers)
    .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, organizationId),
        // Une adhésion suspendue ne compte pas. Couper ici plutôt que dans
        // `can()` garde le point de vérification unique intact : ce n'est pas
        // une permission en moins, c'est une adhésion qui ne vaut plus.
        isNull(organizationMembers.suspendedAt),
      ),
    );

  if (rows.length === 0) return null;

  return {
    organizationId,
    scope: "organization",
    projectIds: [],
    permissions: new Set(rows.map((row) => row.permission as Permission)),
  };
}

/**
 * Charge tous les projets où l'utilisateur est membre dans l'organization.
 * Suffisant tant que ce nombre reste petit — voir docs/backlog #0008 pour la
 * piste si ce n'était plus le cas.
 */
async function projectGrant(
  tx: Transaction,
  userId: string,
  organizationId: string,
): Promise<Grant | null> {
  const rows = await tx
    .select({
      projectId: projectMembers.projectId,
      permission: rolePermissions.permissionKey,
    })
    .from(projectMembers)
    .innerJoin(roles, eq(roles.id, projectMembers.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(
      and(
        eq(projectMembers.userId, userId),
        eq(projectMembers.organizationId, organizationId),
        isNull(projectMembers.suspendedAt),
      ),
    );

  if (rows.length === 0) return null;

  return {
    organizationId,
    scope: "project",
    projectIds: [...new Set(rows.map((row) => row.projectId))],
    permissions: new Set(rows.map((row) => row.permission as Permission)),
  };
}

/**
 * Point de vérification unique. **Refus par défaut** : tout ce qui n'est pas
 * explicitement accordé est refusé.
 *
 * `projectId` restreint la vérification à un projet précis. L'omettre suffit
 * pour les actions qui portent sur l'organization entière.
 */
export function can(actor: Actor, permission: Permission, projectId?: string): boolean {
  const { grant } = actor;
  if (!grant) return false;
  if (!grant.permissions.has(permission)) return false;

  if (grant.scope === "organization") return true;

  // Une portée « projet » ne vaut que dans les projets assignés. Sans projet
  // cible, l'action porte sur l'organization : refusée.
  if (!projectId) return false;
  return grant.projectIds.includes(projectId);
}

/**
 * L'acteur atteint-il ce projet ?
 *
 * ⚠️ **Une question de portée, pas de permission.** Une portée organization
 * les atteint tous ; une portée projet, ceux où l'on est membre. Voir qu'un
 * projet existe relève de l'appartenance — lire son contenu relève de `can()`,
 * et c'est une autre question.
 *
 * ⚠️ Ce test passait par `can(actor, content.read, projectId)`, dont seule la
 * moitié « portée » servait : les six rôles système détiennent tous
 * `content.read`. La moitié « permission » était un passager, et elle mordait
 * dès qu'un rôle personnalisé existait — `apikey.manage` sans `content.read`
 * ne voyait aucun projet, donc n'atteignait jamais l'écran de clés pour lequel
 * ce rôle avait été créé.
 *
 * Si la confidentialité d'un projet devient un jour une fonctionnalité —
 * des projets cachés à certains membres par conception — elle arrivera avec
 * son propre nom. L'ancien test ne la protégeait pas, il la simulait par
 * accident.
 */
export function reachesProject(actor: Actor, projectId: string): boolean {
  const { grant } = actor;
  if (!grant) return false;
  if (grant.scope === "organization") return true;
  return grant.projectIds.includes(projectId);
}

/** Toutes les permissions détenues — sert aux garde-fous d'escalade. */
export function heldPermissions(actor: Actor): ReadonlySet<Permission> {
  return actor.grant?.permissions ?? new Set();
}

/**
 * Acteur machine : une clé API résolue.
 *
 * Elle n'a **pas** d'utilisateur — d'où l'acteur polymorphe du journal d'audit
 * (ADR 0008). Sa portée est un environnement, pas une organization : c'est le
 * seul acteur dont les droits ne viennent pas d'une adhésion.
 */
export type KeyActor = {
  apiKeyId: string;
  environmentId: string;
  organizationId: string;
  permissions: ReadonlySet<Permission>;
};

/**
 * Vérification pour un acteur machine. Même catalogue que `can()`, refus par
 * défaut identique — un seul vocabulaire d'autorisation pour les deux types
 * d'acteurs (ADR 0004).
 */
export function keyCan(actor: KeyActor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}
