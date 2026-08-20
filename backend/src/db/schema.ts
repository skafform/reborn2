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
  ],
);

export const environments = pgTable(
  "environments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    unique("environments_project_id_name_key").on(table.projectId, table.name),
    index("environments_project_id_idx").on(table.projectId),
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
