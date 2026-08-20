import type { Permission } from "../config/permissions.ts";
import { type Actor, can, heldPermissions } from "./authorization.ts";

/**
 * Garde-fous contre l'escalade de privilèges.
 *
 * La base garantit déjà beaucoup — un membre ne peut recevoir le rôle d'une
 * autre organization, les rôles système sont figés, une organization conserve
 * toujours un `owner`. Mais elle ne peut pas garantir la règle centrale :
 * **on n'accorde pas une permission qu'on ne détient pas**. Celle-ci dépend de
 * l'acteur, que la base ne connaît pas.
 *
 * Sans elle, un `admin` crée un rôle portant `org.delete`, se l'assigne, et
 * devient propriétaire de fait — l'escalade par endpoint d'administration,
 * vecteur principal signalé par la littérature.
 *
 * Voir ADR 0011 et docs/backlog #0006.
 */

export class AuthorizationError extends Error {
  /** 403 : l'acteur voit la ressource mais n'a pas ce droit (ADR 0012). */
  readonly status = 403 as const;
  readonly reason: "missing_permission" | "escalation";

  constructor(message: string, reason: "missing_permission" | "escalation") {
    super(message);
    this.name = "AuthorizationError";
    this.reason = reason;
  }
}

/** Refuse si la permission n'est pas détenue. Point d'échec unique (CWE-280). */
export function requirePermission(
  actor: Actor,
  permission: Permission,
  projectId?: string,
): void {
  if (!can(actor, permission, projectId)) {
    throw new AuthorizationError(
      `permission requise : ${permission}`,
      "missing_permission",
    );
  }
}

/**
 * Refuse d'accorder au-delà de ce que l'acteur détient.
 *
 * À appliquer **aux deux moments** où des permissions changent de mains :
 * quand un rôle est créé ou modifié, et quand il est assigné à quelqu'un.
 * Vérifier uniquement à la création laisserait assigner un rôle préexistant
 * plus puissant que soi.
 */
export function requireCanGrant(actor: Actor, granted: Iterable<Permission>): void {
  const held = heldPermissions(actor);
  const excess = [...granted].filter((permission) => !held.has(permission));

  if (excess.length > 0) {
    throw new AuthorizationError(
      `impossible d'accorder une permission non détenue : ${excess.sort().join(", ")}`,
      "escalation",
    );
  }
}

/** Créer ou modifier un rôle : le droit de gérer, puis la règle d'escalade. */
export function requireCanDefineRole(
  actor: Actor,
  permissions: Iterable<Permission>,
): void {
  requirePermission(actor, "role.manage");
  requireCanGrant(actor, permissions);
}

/**
 * Assigner un rôle. Les rôles système `owner` et `admin` exigent en plus
 * `member.manage_admin`, que seul un `owner` détient — un `admin` ne peut donc
 * ni promouvoir vers son propre niveau, ni évincer un pair.
 */
export function requireCanAssignRole(
  actor: Actor,
  role: { name: string; isSystem: boolean; permissions: Iterable<Permission> },
): void {
  const privileged = role.isSystem && (role.name === "owner" || role.name === "admin");
  requirePermission(actor, privileged ? "member.manage_admin" : "member.manage");
  requireCanGrant(actor, role.permissions);
}
