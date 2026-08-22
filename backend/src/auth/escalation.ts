import { PERMISSIONS, type Permission } from "../config/permissions.ts";
import { ServiceError } from "../services/service-error.ts";
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

export class AuthorizationError extends ServiceError {
  /** 403 : l'acteur voit la ressource mais n'a pas ce droit (ADR 0012). */
  declare readonly status: 403;
  declare readonly reason: "missing_permission" | "escalation";

  constructor(message: string, reason: "missing_permission" | "escalation") {
    super(403, reason, message);
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
  requirePermission(actor, PERMISSIONS.roleManage);
  requireCanGrant(actor, permissions);
}

export type AssignableRole = {
  name: string;
  isSystem: boolean;
  permissions: Iterable<Permission>;
};

/**
 * L'acteur peut-il assigner ce rôle ? Version **booléenne**, pour que
 * l'interface n'offre pas ce qui sera refusé — même paire que `can()` et
 * `requirePermission()`.
 *
 * ⚠️ Ne jamais réimplémenter cette règle ailleurs, et surtout pas côté client.
 * Elle a deux volets, dont le second n'est pas déductible d'un nom de rôle :
 * `owner` et `admin` exigent `member.manage_admin`, **et** on doit détenir
 * chacune des permissions du rôle qu'on accorde.
 */
export function canAssignRole(actor: Actor, role: AssignableRole): boolean {
  if (!can(actor, requiredToTouch(role))) return false;

  const held = heldPermissions(actor);
  return [...role.permissions].every((permission) => held.has(permission));
}

/**
 * Quelle permission il faut détenir pour toucher à quelqu'un qui porte ce
 * rôle — l'assigner, le retirer, le suspendre.
 *
 * `owner` et `admin` exigent `member.manage_admin`, que seul un `owner`
 * détient. C'est ce qui empêche un `admin` de promouvoir vers son propre
 * niveau **comme** d'évincer un pair.
 */
function requiredToTouch(role: { name: string; isSystem: boolean }): Permission {
  const privileged = role.isSystem && (role.name === "owner" || role.name === "admin");
  return privileged ? PERMISSIONS.memberManageAdmin : PERMISSIONS.memberManage;
}

/**
 * L'acteur peut-il agir sur un membre portant ce rôle ? Retrait, suspension,
 * changement de rôle — la même règle gouverne les trois.
 *
 * **Miroir exact de l'assignation, moins la règle d'escalade** : retirer
 * quelqu'un n'accorde aucune permission, donc rien à comparer. Ne subsiste que
 * la question du niveau.
 *
 * ⚠️ Version booléenne, pour que l'API dise à l'interface ce qu'elle peut
 * offrir. Sans elle, la console devrait comparer les rôles elle-même —
 * c'est-à-dire recopier la matrice RBAC hors de sa source de vérité.
 */
export function canManageMember(
  actor: Actor,
  role: { name: string; isSystem: boolean },
  projectId?: string,
): boolean {
  return can(actor, requiredToTouch(role), projectId);
}

/** Le refus correspondant. Seule autorité ; `canManageMember` sert l'affichage. */
export function requireCanManageMember(
  actor: Actor,
  role: { name: string; isSystem: boolean },
  projectId?: string,
): void {
  requirePermission(actor, requiredToTouch(role), projectId);
}

/**
 * Assigner un rôle. Les rôles système `owner` et `admin` exigent en plus
 * `member.manage_admin`, que seul un `owner` détient — un `admin` ne peut donc
 * ni promouvoir vers son propre niveau, ni évincer un pair.
 *
 * Reste la seule autorité : `canAssignRole` sert à l'affichage, ce refus-ci
 * sert de garde-fou, et il énonce **quelle** permission manque.
 */
export function requireCanAssignRole(actor: Actor, role: AssignableRole): void {
  requirePermission(actor, requiredToTouch(role));
  requireCanGrant(actor, role.permissions);
}
