import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
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
    /**
     * La version courante — l'empreinte de `{ name, label, definition }`
     * ([ADR 0016](../../../docs/adr/0016-versionnage-des-schemas-adresse-par-contenu.md)).
     *
     * ⚠️ **`NOT NULL` avec une clé étrangère composite** vers
     * `schema_versions` : « le courant pointe toujours sur une version
     * réelle » devient une propriété de la forme, pas une discipline. Les
     * colonnes ci-dessus sont donc redondantes avec la version pointée — c'est
     * voulu : lire un schéma ne doit pas coûter une jointure.
     */
    currentHash: text("current_hash").notNull(),
    ...timestamps,
  },
  (table) => [
    // ⚠️ Colonne de cadrage en tête : le `WHERE` implicite qu'ajoutent les
    // policies forcerait sinon un balayage complet.
    index("schemas_organization_id_idx").on(table.organizationId, table.environmentId),
    unique("schemas_environment_id_name_key").on(table.environmentId, table.name),
    // Cible de la clé étrangère composite du journal : c'est elle qui interdit
    // à une ligne d'historique de traverser deux cadrages.
    unique("schemas_id_organization_id_key").on(table.id, table.organizationId),
    foreignKey({
      columns: [table.environmentId, table.organizationId],
      foreignColumns: [environments.id, environments.organizationId],
      name: "schemas_environment_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.currentHash],
      foreignColumns: [schemaVersions.organizationId, schemaVersions.hash],
      name: "schemas_current_version_fk",
    }),
  ],
);

/**
 * Une version : du contenu immuable, dédupliqué — le *blob* d'ADR 0016.
 *
 * ⚠️ **Pas d'`id`.** La clé primaire est `(organization_id, hash)`, parce que
 * l'identité d'une version **est** son contenu. Un identifiant de substitution
 * permettrait deux lignes pour une même définition, ce qui est exactement ce
 * que l'adressage par contenu élimine.
 *
 * ⚠️ **Aucune lignée ici.** Deux schémas qui convergent vers une définition
 * identique partagent cette ligne ; un `parent_hash` posé dessus mêlerait deux
 * histoires sans rapport. La lignée vit dans `schema_history`.
 *
 * ⚠️ **La déduplication est par organization**, jamais globale — une table
 * globale n'a pas de colonne de cadrage, donc pas de RLS, et le `created_at`
 * d'une ligne partagée révélerait qu'une autre organization détient le même
 * modèle de contenu.
 *
 * ⚠️ `ON DELETE CASCADE` sur l'organization, contrairement à `schemas` : une
 * version n'a pas d'autre parent qui l'emporterait. En `RESTRICT`, supprimer
 * une organization deviendrait impossible — le défaut qu'a déjà connu
 * `docs/backlog #0010`.
 */
export const schemaVersions = pgTable(
  "schema_versions",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** `sha256-1:<hex>` — jamais l'hexadécimal nu. Voir `fingerprint.ts`. */
    hash: text("hash").notNull(),
    /**
     * ⚠️ **Les trois colonnes que l'empreinte couvre**, pas la seule
     * définition. Une version qui ne peut pas restaurer le libellé est une
     * version d'un fragment (architecture/content-schemas.md).
     */
    name: text("name").notNull(),
    label: text("label"),
    definition: jsonb("definition").notNull().$type<Definition>(),
    /**
     * ⚠️ Celui de la **première** apparition, et il ne bouge jamais. Un
     * retour à une définition antérieure retrouve cette ligne telle quelle :
     * une version est un contenu, pas un événement. Pas d'`updated_at`.
     */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // La clé primaire porte déjà la colonne de cadrage en tête : aucun index
    // supplémentaire à ajouter pour les policies.
    primaryKey({ columns: [table.organizationId, table.hash] }),
  ],
);

/** Ce qu'une ligne de journal enregistre. */
export const HISTORY_ACTIONS = ["saved", "restored"] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

/**
 * Le journal d'un schéma : en ajout seul, ordonné — le *commit* d'ADR 0016.
 *
 * ⚠️ **Jamais réécrit.** Une restauration ajoute une ligne qui dit « l'état
 * est redevenu X » ; l'aller-retour A → B → A reste visible, parce que c'est
 * un fait.
 */
export const schemaHistory = pgTable(
  "schema_history",
  {
    /**
     * ⚠️ **L'ordre du journal, et la seule chose qui puisse le porter.**
     * `created_at` vaut `now()`, l'horodatage de *début de transaction* : deux
     * enregistrements concurrents peuvent le partager, et un journal dont
     * l'ordre est indécidable ne répond plus à « quel état, dans quel ordre »,
     * qui est sa seule raison d'être.
     *
     * ⚠️ **Jamais exposée** : c'est de l'ordre, pas de l'information. Une
     * séquence globale dirait le volume d'écriture de la plateforme.
     */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    schemaId: uuid("schema_id").notNull(),
    hash: text("hash").notNull(),
    action: text("action").notNull().$type<HistoryAction>(),
    /**
     * ⚠️ **Recoupe le journal d'audit, et c'est assumé**
     * ([ADR 0008](../../../docs/adr/0008-point-d-emission-d-evenements-unique.md)).
     * L'historique répond « quel état, dans quel ordre », l'audit « qui a fait
     * quoi » — mais un écran de lignée incapable de dire qui a restauré est
     * inutilisable, et une jointure applicative vers l'audit par ligne
     * d'écran paierait la pureté conceptuelle en complexité réelle.
     *
     * `text`, comme partout : Better-Auth génère des identifiants texte. La
     * clé étrangère vers `"user"` est posée dans la migration — cette table
     * appartient à l'autre propriétaire de schéma. `ON DELETE SET NULL` :
     * l'histoire survit aux comptes.
     */
    actorUserId: text("actor_user_id"),
    /** Pour les humains. L'ordre, lui, vient de `seq`. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Colonne de cadrage en tête, puis le schéma lu, puis l'ordre rendu.
    index("schema_history_organization_id_idx").on(
      table.organizationId,
      table.schemaId,
      table.seq,
    ),
    foreignKey({
      columns: [table.schemaId, table.organizationId],
      foreignColumns: [schemas.id, schemas.organizationId],
      name: "schema_history_schema_fk",
    }).onDelete("cascade"),
    // ⚠️ Une ligne d'historique ne peut pas nommer une version fantôme.
    foreignKey({
      columns: [table.organizationId, table.hash],
      foreignColumns: [schemaVersions.organizationId, schemaVersions.hash],
      name: "schema_history_version_fk",
    }),
    check("schema_history_action_check", sql`action in ('saved', 'restored')`),
  ],
);
