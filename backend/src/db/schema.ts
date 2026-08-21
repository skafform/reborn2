import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Tables applicatives, gérées par Drizzle.
 *
 * Les tables de Better-Auth (`user`, `session`, `account`, `verification`) ne
 * sont **pas** décrites ici : elles lui appartiennent et il les migre lui-même
 * (ADR 0002). Seule `user.id` est référencée, en `text` — Better-Auth génère
 * des identifiants texte, pas des UUID.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ...timestamps,
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // RESTRICT, pas CASCADE : une organization ne se supprime que vidée
    // (architecture/multi-tenant.md). La règle devient une contrainte de base
    // plutôt qu'une vérification qu'on peut oublier.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    ...timestamps,
  },
  (table) => [
    // Colonne de cadrage en tête : RLS ajoute un WHERE implicite dessus
    // (ADR 0003).
    index("projects_organization_id_idx").on(table.organizationId),
    // Cible de la clé étrangère composite de `project_members`, qui garantit
    // qu'un membre de projet est rattaché à l'organization propriétaire.
    unique("projects_id_organization_id_key").on(table.id, table.organizationId),
  ],
);

export const environments = pgTable(
  "environments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /**
     * Dénormalisé depuis `projects`. Deux raisons : cadrer un environnement
     * sans jointure, et surtout **rompre un cycle de policies** — sans cela,
     * lire `projects` consulte `environments`, dont la policy consulte
     * `projects`. Postgres détecte la récursion et refuse la requête.
     */
    organizationId: uuid("organization_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    unique("environments_project_id_name_key").on(table.projectId, table.name),
    index("environments_project_id_idx").on(table.projectId),
    index("environments_organization_id_idx").on(table.organizationId),
    unique("environments_id_organization_id_key").on(table.id, table.organizationId),
    foreignKey({
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
      name: "environments_project_fk",
    }),
    // Le nom finit dans des URLs d'API (ADR 0006, convention Sanity).
    check(
      "environments_name_format",
      sql`${table.name} ~ '^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$'`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Autorisation
// ---------------------------------------------------------------------------

/**
 * Vocabulaire des permissions. Alimenté par migration depuis le catalogue
 * défini en code (`config/permissions.ts`), et servant de cible de clé
 * étrangère : aucune permission inconnue ne peut être accordée (ADR 0011).
 */
export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
});

export const roleScope = pgEnum("role_scope", ["organization", "project"]);

/**
 * Chaque organization possède ses propres rôles, y compris des copies des
 * rôles système marquées `is_system` — ni modifiables, ni supprimables.
 *
 * La duplication est délibérée : elle permet à `organization_members` de
 * référencer un rôle par clé étrangère **composite**, rendant structurellement
 * impossible d'assigner à un membre le rôle d'une autre organization.
 */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scope: roleScope("scope").notNull(),
    name: text("name").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    unique("roles_organization_id_scope_name_key").on(
      table.organizationId,
      table.scope,
      table.name,
    ),
    // Cible de la clé étrangère composite des tables d'adhésion.
    unique("roles_organization_id_id_key").on(table.organizationId, table.id),
    index("roles_organization_id_idx").on(table.organizationId),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionKey] }),
    index("role_permissions_role_id_idx").on(table.roleId),
  ],
);

/**
 * `user_id` est en `text` : Better-Auth génère des identifiants texte. La
 * clé étrangère vers `"user"` n'est pas déclarée ici — cette table appartient
 * à Better-Auth et Drizzle ne la connaît pas (ADR 0002). Elle est ajoutée par
 * migration.
 */
export const organizationMembers = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
    /**
     * Renseigné : l'adhésion existe toujours, avec son rôle, mais ne donne plus
     * aucun accès. Lu à la **résolution du grant**, jamais dans `can()` — une
     * suspension n'est pas une permission en moins, c'est une adhésion qui ne
     * compte plus (architecture/roles-permissions.md).
     */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    // Le rôle assigné doit appartenir à la même organization que le membre.
    // Contrainte de base, pas vérification applicative (ADR 0011).
    foreignKey({
      columns: [table.organizationId, table.roleId],
      foreignColumns: [roles.organizationId, roles.id],
      name: "organization_members_role_fk",
    }),
    index("organization_members_user_id_idx").on(table.userId),
  ],
);

/**
 * Adhésion à un projet, pour les acteurs **extérieurs à l'organization** —
 * pigiste, client. Table indépendante de `organization_members` : un rôle
 * d'organization couvre déjà tous les projets, les deux ne se cumulent pas
 * (architecture/roles-permissions.md).
 *
 * `organization_id` est dénormalisé depuis `projects` pour porter la clé
 * étrangère composite vers `roles` — un membre de projet ne peut recevoir que
 * le rôle de l'organization propriétaire de ce projet (ADR 0011).
 */
export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
    /** Même sens que sur `organization_members`. */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    foreignKey({
      columns: [table.organizationId, table.roleId],
      foreignColumns: [roles.organizationId, roles.id],
      name: "project_members_role_fk",
    }),
    // Le projet doit appartenir à l'organization dénormalisée ici.
    foreignKey({
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
      name: "project_members_project_fk",
    }),
    index("project_members_user_id_idx").on(table.userId),
    index("project_members_organization_id_idx").on(table.organizationId),
  ],
);

/**
 * Invitation à rejoindre une organization ou un projet précis.
 *
 * `project_id` nul → invitation au niveau organization ; renseigné →
 * invitation à un projet, qui ne crée **jamais** d'adhésion à l'organization
 * (architecture/invitations.md).
 *
 * Seul le **hachage** du jeton est stocké : le jeton lui-même ne vit que dans
 * l'email. Même raisonnement que pour la clé API secrète — si la base fuit,
 * les invitations en attente restent inutilisables.
 *
 * `email` est immuable : corriger une adresse impose d'annuler et de recréer,
 * sans quoi une invitation validée pour une personne serait redirigée vers une
 * autre.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    email: text("email").notNull(),
    roleId: uuid("role_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** `SET NULL` : l'invitation survit à la suppression de son émetteur. */
    invitedBy: text("invited_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.roleId],
      foreignColumns: [roles.organizationId, roles.id],
      name: "invitations_role_fk",
    }),
    index("invitations_organization_id_idx").on(table.organizationId),
    index("invitations_email_idx").on(table.email),
  ],
);

export const apiKeyKind = pgEnum("api_key_kind", ["public", "preview", "secret"]);

/**
 * Clés d'accès machine, rattachées à un **environnement** (ADR 0013) : deux
 * environnements dans un projet font deux triplets.
 *
 * Le stockage est asymétrique, et c'est délibéré (architecture/api.md) :
 *
 * - `token` porte la clé en clair pour les types **publique** et **preview**,
 *   qu'il faut pouvoir reconsulter pour les recopier dans un site
 * - `token_hash` porte le hachage de la clé **secrète**, affichée une seule
 *   fois à la création. Seule elle donne un droit d'écriture ; si la base
 *   fuit, elle reste inutilisable
 *
 * Exactement une des deux colonnes est renseignée, ce que garantit une
 * contrainte de vérification.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    /**
     * Dénormalisé, comme sur `environments`. Une policy qui traverse une autre
     * table dont la policy revient vers elle forme un cycle que Postgres
     * refuse. Porter la colonne de cadrage rend chaque policy autonome — et
     * résoudre une clé devient une requête sur une seule table.
     */
    organizationId: uuid("organization_id").notNull(),
    kind: apiKeyKind("kind").notNull(),
    name: text("name").notNull(),
    /** Clé en clair — types publique et preview uniquement. */
    token: text("token").unique(),
    /** Hachage — type secret uniquement. */
    tokenHash: text("token_hash").unique(),
    /** Préfixe affichable, pour reconnaître une clé secrète sans la révéler. */
    hint: text("hint").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("api_keys_environment_id_idx").on(table.environmentId),
    index("api_keys_organization_id_idx").on(table.organizationId),
    foreignKey({
      columns: [table.environmentId, table.organizationId],
      foreignColumns: [environments.id, environments.organizationId],
      name: "api_keys_environment_fk",
    }),
    check(
      "api_keys_secret_is_hashed",
      sql`(${table.kind} = 'secret' AND ${table.tokenHash} IS NOT NULL AND ${table.token} IS NULL)
       OR (${table.kind} <> 'secret' AND ${table.token} IS NOT NULL AND ${table.tokenHash} IS NULL)`,
    ),
  ],
);
