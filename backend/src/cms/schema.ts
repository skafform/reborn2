import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { environments, organizations } from "../db/schema.ts";
import type { Definition } from "./definition.ts";

/**
 * Les tables du CMS.
 *
 * ⚠️ **Elles vivent ici, pas dans `db/schema.ts`.** Le socle n'a aucune raison
 * de porter la table des types de contenu. La flèche va dans un seul sens :
 * ce module importe `organizations` et `environments` du socle pour ses clés
 * étrangères, jamais l'inverse (ADR 0019).
 *
 * `drizzle.config.ts` nomme les deux fichiers — c'est un point de composition,
 * hors de `src/`, donc hors de la règle d'import.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Un type de contenu : sa définition, dans un environnement.
 *
 * ⚠️ **`environment_id`, jamais `project_id`** (ADR 0006). Un projet ne
 * contient pas de schéma ; il contient des environnements, qui en contiennent.
 * Aujourd'hui il n'y a qu'un `master` par projet, invisible dans l'UI — mais
 * c'est ce qui permettra un jour d'éprouver un changement destructif de schéma
 * contre du contenu réel sans casser la production.
 */
export const schemas = pgTable(
  "schemas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    /**
     * ⚠️ Dénormalisé, comme sur `api_keys` et `environments`. Une policy qui
     * traverse une autre table sous RLS forme un cycle que Postgres refuse ;
     * porter sa colonne de cadrage rend chaque policy autonome
     * (architecture/securite.md).
     */
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    /** L'identifiant du type de contenu, unique dans son environnement. */
    name: text("name").notNull(),
    /** Ce qu'on renomme sans rien casser. */
    label: text("label"),
    /** Voir `definition.ts` — la forme est hachable, donc sans ambiguïté. */
    definition: jsonb("definition").notNull().$type<Definition>(),
    ...timestamps,
  },
  (table) => [
    // ⚠️ Colonne de cadrage en tête : le `WHERE` implicite qu'ajoutent les
    // policies forcerait sinon un balayage complet.
    index("schemas_organization_id_idx").on(table.organizationId, table.environmentId),
    unique("schemas_environment_id_name_key").on(table.environmentId, table.name),
    foreignKey({
      columns: [table.environmentId, table.organizationId],
      foreignColumns: [environments.id, environments.organizationId],
      name: "schemas_environment_fk",
    }),
  ],
);
