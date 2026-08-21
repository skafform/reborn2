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

export const PERMISSIONS = {
  "content.read": "Lire le contenu publié",
  "content.read_draft": "Lire les brouillons",
  "content.write": "Créer et modifier du contenu",
  "content.publish": "Publier du contenu",

  "schema.read": "Lire les définitions de types de contenu",
  "schema.write": "Créer et modifier les types de contenu",

  "member.read": "Voir les membres de l'organization",
  "member.manage": "Inviter, retirer et changer le rôle d'un membre non privilégié",
  "member.manage_admin": "Accorder ou retirer les rôles owner et admin",

  "role.manage": "Créer et modifier les rôles personnalisés",
  "apikey.manage": "Créer, révoquer et supprimer les clés API",

  "project.create": "Créer un projet",
  "project.delete": "Supprimer un projet",

  "org.settings": "Modifier les paramètres de l'organization",
  "org.billing": "Gérer la facturation",
  "org.transfer": "Transférer la propriété de l'organization",
  "org.delete": "Supprimer l'organization",
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
    permissions: [
      ...CONTENT_READ,
      "content.write",
      "content.publish",
      "schema.write",
      "member.read",
      "member.manage",
      "role.manage",
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
