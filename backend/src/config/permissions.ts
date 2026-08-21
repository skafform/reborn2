/**
 * Catalogue de permissions et définition des rôles système.
 *
 * Le **catalogue** reste en code : c'est le vocabulaire de l'autorisation. Il
 * alimente la table `permissions` par migration, qui sert de cible de clé
 * étrangère — aucune permission inconnue ne peut donc être accordée.
 *
 * La **correspondance rôle → permissions** vit en base, les organizations
 * pouvant définir leurs propres rôles (ADR 0011). Ce qui suit ne décrit que
 * les rôles **système**, copiés dans chaque organization à sa création.
 *
 * Règle de découpage (ADR 0004) : une permission existe quand elle exprime une
 * différence réelle dans la matrice. Deux permissions dont les colonnes
 * seraient identiques partout n'en font qu'une.
 */

/**
 * ⚠️ These descriptions are **user-facing labels**, not developer messages.
 * They are what the console shows next to each checkbox when someone composes
 * a role, which is why they read as sentences and why they are in English —
 * translating them console-side would copy the catalogue out of its source of
 * truth.
 */
export const PERMISSIONS = {
  "content.read": "Read published content",
  "content.read_draft": "Read drafts",
  "content.write": "Create and edit content",
  "content.publish": "Publish content",

  "schema.read": "Read content type definitions",
  "schema.write": "Create and edit content types",

  "member.read": "See who is in the organization",
  "member.manage": "Invite, remove and change the role of a non-privileged member",
  "member.manage_admin": "Grant or revoke the owner and admin roles",

  "role.manage": "Create and edit custom roles",
  "apikey.manage": "Create, revoke and delete API keys",

  "project.create": "Create a project",
  "project.delete": "Delete a project",

  "org.settings": "Change organization settings",
  "org.billing": "Manage billing",
  "org.transfer": "Transfer ownership of the organization",
  "org.delete": "Delete the organization",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

export type RoleScope = "organization" | "project";

export type SystemRole = {
  name: string;
  scope: RoleScope;
  permissions: readonly Permission[];
};

const CONTENT_READ = [
  "content.read",
  "content.read_draft",
  "schema.read",
] as const satisfies readonly Permission[];

/**
 * Rôles système, copiés dans chaque organization à sa création et marqués
 * `is_system` — ni modifiables, ni supprimables.
 *
 * `owner` détient l'intégralité du catalogue : c'est ce qui garantit qu'il
 * peut toujours accorder n'importe quelle permission, la règle d'escalade
 * interdisant d'accorder ce qu'on ne détient pas.
 */
export const SYSTEM_ROLES: readonly SystemRole[] = [
  {
    name: "owner",
    scope: "organization",
    permissions: PERMISSION_KEYS,
  },
  {
    name: "admin",
    scope: "organization",
    /**
     * ⚠️ **No `role.manage`** (ADR 0014). An admin assigns the roles that
     * exist; they do not decide what a role *means*. Without an audit log the
     * role list is the only trace of a change to the permission model, and it
     * only works as a trace if one person writes to it.
     *
     * Delegation stays possible and becomes explicit: an owner creates a
     * custom role that carries it.
     */
    permissions: [
      ...CONTENT_READ,
      "content.write",
      "content.publish",
      "schema.write",
      "member.read",
      "member.manage",
      "apikey.manage",
      "project.create",
      "org.settings",
    ],
  },
  {
    name: "viewer",
    scope: "organization",
    // Un `viewer` est « un admin sans écriture » : il voit l'équipe sans
    // pouvoir la modifier. C'est ce qui distingue `member.read` de
    // `member.manage` — sans cette colonne, les deux n'en feraient qu'une
    // (ADR 0004).
    permissions: [...CONTENT_READ, "member.read"],
  },
  {
    name: "editor",
    scope: "project",
    permissions: [...CONTENT_READ, "content.write", "content.publish"],
  },
  {
    name: "contributor",
    scope: "project",
    permissions: [...CONTENT_READ, "content.write"],
  },
  {
    name: "guest",
    scope: "project",
    permissions: [...CONTENT_READ],
  },
];
