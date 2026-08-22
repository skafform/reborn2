/**
 * Le vocabulaire de l'autorisation, et la seule fabrique qui le remplit.
 *
 * ⚠️ **Le socle ne nomme jamais une permission du CMS**, et n'a pas à le
 * pouvoir : `Permission` n'est pas une union de littéraux mais un **type
 * marqué**, dont la seule source est `definePermission`. Un module extérieur
 * enregistre les siennes en important celui-ci — la flèche va dans un seul
 * sens, et `can()` reste unique (ADR 0019).
 *
 * La conséquence utile n'est pas le typage, c'est la **preuve** : détenir une
 * `Permission` prouve que son enregistrement a eu lieu, puisque le seul moyen
 * de l'obtenir est d'importer la constante, donc d'exécuter la fabrique. Il
 * n'y a pas d'ordre de chargement à vérifier pour un point d'appel — il ne
 * peut pas être faux.
 *
 * Règle de découpage (ADR 0004) : une permission existe quand elle exprime une
 * différence réelle dans la matrice. Deux permissions dont les colonnes
 * seraient identiques partout n'en font qu'une.
 */

declare const permissionBrand: unique symbol;

/**
 * Une clé de permission, et la preuve qu'elle est enregistrée.
 *
 * Le marquage n'a pas de réalité à l'exécution — c'est une chaîne. Il n'existe
 * que pour rendre impossible de passer à `can()` une clé qui n'est pas passée
 * par la fabrique.
 */
export type Permission = string & { readonly [permissionBrand]: true };

export type RoleScope = "organization" | "project";

/**
 * Les rôles système, copiés dans chaque organization à sa création et marqués
 * `is_system` — ni modifiables, ni supprimables.
 *
 * Seuls leurs **noms et portées** vivent ici. Ce que chacun détient se déclare
 * permission par permission, plus bas et dans les autres couches : c'est ce
 * qui permet au CMS d'accorder les siennes sans que le socle les connaisse.
 */
export const SYSTEM_ROLES = [
  { name: "owner", scope: "organization" },
  { name: "admin", scope: "organization" },
  { name: "viewer", scope: "organization" },
  { name: "editor", scope: "project" },
  { name: "contributor", scope: "project" },
  { name: "guest", scope: "project" },
] as const satisfies readonly { name: string; scope: RoleScope }[];

export type SystemRoleName = (typeof SYSTEM_ROLES)[number]["name"];

/** Tout sauf `owner`, qui reçoit l'intégralité du catalogue par construction. */
type GrantableRole = Exclude<SystemRoleName, "owner">;

type Registration = {
  key: string;
  /**
   * ⚠️ Libellé destiné aux **utilisateurs**, pas aux développeurs : c'est ce
   * que la console affiche à côté de chaque case quand on compose un rôle.
   * D'où des phrases, et de l'anglais — le traduire côté console recopierait
   * le catalogue hors de sa source de vérité.
   */
  description: string;
  roles: readonly GrantableRole[];
};

const registry = new Map<string, Registration>();

/**
 * Déclare une permission, ses détenteurs par défaut, et rend sa valeur.
 *
 * ⚠️ **`owner` n'est jamais listé** : il reçoit tout le catalogue,
 * automatiquement. C'est ce qui garantit qu'il peut toujours accorder
 * n'importe quelle permission, la règle d'escalade interdisant d'accorder ce
 * qu'on ne détient pas. Le lui faire répéter à chaque appel transformerait une
 * garantie en dix-huit occasions de l'oublier.
 *
 * Échoue au chargement sur une clé en double : deux couches qui revendiquent
 * le même mot est une erreur de conception, pas un cas à arbitrer.
 */
export function definePermission(
  key: string,
  spec: { description: string; roles: readonly GrantableRole[] },
): Permission {
  if (registry.has(key)) throw new Error(`permission déjà définie : ${key}`);
  registry.set(key, { key, ...spec });
  // La seule assertion sanctionnée du mécanisme, et son unique raison d'être :
  // transformer une chaîne vérifiée en valeur admise.
  return key as Permission;
}

/**
 * Le catalogue, dans l'ordre de déclaration.
 *
 * ⚠️ Il ne contient que ce que les modules **chargés** ont enregistré. Pour
 * `can()` c'est sans conséquence — on ne peut pas tenir une permission non
 * enregistrée. Pour le semage des rôles, ça compte : voir
 * `db/preconditions.ts`, qui vérifie au démarrage que le registre et la table
 * `permissions` disent la même chose.
 */
export function permissionCatalogue(): readonly Registration[] {
  return [...registry.values()];
}

/** Toutes les clés enregistrées — pour composer un rôle, ou lister ce qu'un
 *  acteur détient. Même ordre que le catalogue. */
export function permissionKeys(): readonly Permission[] {
  return [...registry.keys()].map((key) => key as Permission);
}

/**
 * Ramène des chaînes venues de l'extérieur à des permissions.
 *
 * ⚠️ **Le seul autre point d'entrée du marquage**, et il ne l'accorde pas : il
 * le **vérifie** contre le registre. C'est ce qu'il faut au corps d'une requête
 * — composer un rôle personnalisé consiste précisément à envoyer des clés — et
 * ça reste fermé par défaut : une clé inconnue lève, elle ne passe pas.
 *
 * La validation Zod de la route rejette déjà l'inconnu ; ceci le rejette une
 * seconde fois, parce que c'est ici que la garantie du type se joue.
 */
export function toPermissions(keys: readonly string[]): readonly Permission[] {
  return keys.map((key) => {
    if (!registry.has(key)) throw new Error(`permission inconnue : ${key}`);
    return key as Permission;
  });
}

/** Les permissions d'un rôle système, `owner` recevant tout le catalogue. */
export function permissionsOf(role: SystemRoleName): readonly Permission[] {
  const all = [...registry.values()];
  const held =
    role === "owner" ? all : all.filter((entry) => entry.roles.includes(role));
  return held.map((entry) => entry.key as Permission);
}

// ---------------------------------------------------------------------------
// Les permissions du socle
// ---------------------------------------------------------------------------

/**
 * ⚠️ **Le vocabulaire du contenu est encore ici**, alors qu'il appartient au
 * CMS. Le sortir n'est pas un déplacement de clés : `services/api-keys.ts` et
 * `services/organizations.ts` s'en **servent** — la portée d'une clé publique
 * *est* une liste de permissions de contenu, et la visibilité d'un projet est
 * gardée par `content.read`. Voir docs/backlog #0014.
 */
export const PERMISSIONS = {
  contentRead: definePermission("content.read", {
    description: "Read published content",
    roles: ["admin", "viewer", "editor", "contributor", "guest"],
  }),

  contentReadDraft: definePermission("content.read_draft", {
    description: "Read drafts",
    roles: ["admin", "viewer", "editor", "contributor", "guest"],
  }),

  contentWrite: definePermission("content.write", {
    description: "Create and edit content",
    roles: ["admin", "editor", "contributor"],
  }),

  contentPublish: definePermission("content.publish", {
    description: "Publish content",
    // ⚠️ `contributor` en est exclu, et c'est toute la différence entre les
    // deux rôles : écrire n'est pas publier.
    roles: ["admin", "editor"],
  }),

  schemaRead: definePermission("schema.read", {
    description: "Read content type definitions",
    roles: ["admin", "viewer", "editor", "contributor", "guest"],
  }),

  /**
   * ⚠️ Exclue à `editor`, même s'il peut écrire du contenu : modifier un
   * schéma est un changement **structurel**, qui peut casser des documents
   * existants — pas une modification de contenu
   * (architecture/content-schemas.md).
   */
  schemaWrite: definePermission("schema.write", {
    description: "Create and edit content types",
    roles: ["admin"],
  }),

  memberRead: definePermission("member.read", {
    description: "See who is in the organization",
    // Un `viewer` est « un admin sans écriture » : il voit l'équipe sans
    // pouvoir la modifier. C'est ce qui distingue `member.read` de
    // `member.manage` — sans cette colonne, les deux n'en feraient qu'une
    // (ADR 0004).
    roles: ["admin", "viewer"],
  }),

  memberManage: definePermission("member.manage", {
    description: "Invite, remove and change the role of a non-privileged member",
    roles: ["admin"],
  }),

  memberManageAdmin: definePermission("member.manage_admin", {
    description: "Grant or revoke the owner and admin roles",
    roles: [],
  }),

  /**
   * ⚠️ **Le owner seul** (ADR 0014). Un admin attribue les rôles qui
   * existent ; il ne décide pas de ce qu'un rôle *veut dire*. Faute de journal
   * d'audit, la liste des rôles est la seule trace d'un changement du modèle
   * de permissions, et elle ne vaut comme trace que si une seule personne y
   * écrit. La délégation reste possible et devient explicite : un owner crée
   * un rôle personnalisé qui la porte.
   */
  roleManage: definePermission("role.manage", {
    description: "Create and edit custom roles",
    roles: [],
  }),

  apiKeyManage: definePermission("apikey.manage", {
    description: "Create, revoke and delete API keys",
    roles: ["admin"],
  }),

  projectCreate: definePermission("project.create", {
    description: "Create a project",
    roles: ["admin"],
  }),

  projectDelete: definePermission("project.delete", {
    description: "Delete a project",
    roles: [],
  }),

  /**
   * ⚠️ Scindée de `org.settings`, qui couvrait les deux. Le jour où les
   * réglages d'organization sont passés au owner seul, garder une clé unique
   * aurait retiré aux admins le droit de nommer les projets qu'ils créent
   * (migration 0027).
   */
  projectSettings: definePermission("project.settings", {
    description: "Rename a project and edit its description",
    roles: ["admin"],
  }),

  /**
   * ⚠️ **Le owner seul**, comme `role.manage` et pour la même raison : ce qui
   * touche à l'organization — son nom, sa facturation, son existence — lui
   * appartient, et il délègue en fabriquant un rôle qui le dit.
   */
  orgSettings: definePermission("org.settings", {
    description: "Change organization settings",
    roles: [],
  }),

  orgBilling: definePermission("org.billing", {
    description: "Manage billing",
    roles: [],
  }),

  orgTransfer: definePermission("org.transfer", {
    description: "Transfer ownership of the organization",
    roles: [],
  }),

  orgDelete: definePermission("org.delete", {
    description: "Delete the organization",
    roles: [],
  }),
} as const;
