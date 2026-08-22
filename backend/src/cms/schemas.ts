import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { Actor } from "../auth/authorization.ts";
import { requirePermission } from "../auth/escalation.ts";
import { type Transaction, withContext } from "../db/client.ts";
import { ServiceError } from "../services/service-error.ts";
import { type Definition, duplicateFieldName } from "./definition.ts";
import { fingerprint, type VersionedContent } from "./fingerprint.ts";
import { CMS_PERMISSIONS } from "./permissions.ts";
import {
  documents,
  type HistoryAction,
  librarySchemas,
  schemaHistory,
  schemas,
  schemaVersions,
} from "./schema.ts";

/**
 * Les types de contenu d'un environnement, et leur versionnage.
 *
 * L'identité d'une version est l'empreinte de son contenu
 * ([ADR 0016](../../../docs/adr/0016-versionnage-des-schemas-adresse-par-contenu.md)) :
 * `schema_versions` porte du contenu immuable et dédupliqué, `schema_history`
 * un journal par schéma en ajout seul, et `schemas.current_hash` désigne l'état
 * courant. Le tout dans **une transaction** — c'est `withContext` qui l'ouvre.
 */

export class SchemaError extends ServiceError {
  declare readonly status: 404 | 409;
}

type Fields = { name: string; label: string | null; definition: Definition };

const columns = {
  id: schemas.id,
  name: schemas.name,
  label: schemas.label,
  definition: schemas.definition,
  createdAt: schemas.createdAt,
  updatedAt: schemas.updatedAt,
};

/**
 * L'état d'une copie par rapport à la bibliothèque dont elle vient
 * ([ADR 0018](../../../docs/adr/0018-bibliotheque-de-schemas-table-separee.md)),
 * lu par **comparaison d'empreintes** — jamais par un moteur de diff.
 *
 * ⚠️ **`locally_modified` en confond deux** : « seule la copie a bougé » et
 * « les deux ont bougé ». Le diagnostic reste juste, il est seulement moins
 * précis que son nom ne le suggère — d'où ce nom-là et non
 * `diverged_from_library`, pour qu'aucun écran ne le survende. Les distinguer
 * imposerait de comparer des plages d'historique : hors périmètre.
 */
export const ORIGIN_STATES = [
  "identical",
  "library_ahead",
  "locally_modified",
] as const;
export type OriginState = (typeof ORIGIN_STATES)[number];

export async function listSchemas(
  actor: Actor,
  organizationId: string,
  environmentId: string,
) {
  requirePermission(actor, CMS_PERMISSIONS.schemaRead);

  const rows = await withContext({ userId: actor.userId, organizationId }, (tx) =>
    tx
      .select({
        ...columns,
        currentHash: schemas.currentHash,
        libraryId: librarySchemas.id,
        libraryName: librarySchemas.name,
        libraryHash: librarySchemas.currentHash,
        /**
         * ⚠️ **Le second état tient dans cet `EXISTS`** : l'empreinte de la
         * copie a-t-elle jamais été un état de l'entrée de bibliothèque ? Si
         * oui sans être la courante, c'est la bibliothèque qui a avancé.
         */
        knownToLibrary: sql<boolean>`exists (
          select 1 from library_schema_history h
           where h.organization_id = ${schemas.organizationId}
             and h.library_schema_id = ${schemas.copiedFrom}
             and h.hash = ${schemas.currentHash}
        )`,
      })
      .from(schemas)
      // ⚠️ `leftJoin` : un type créé directement n'a pas de provenance, et ce
      // n'est pas une anomalie.
      .leftJoin(
        librarySchemas,
        and(
          eq(librarySchemas.organizationId, schemas.organizationId),
          eq(librarySchemas.id, schemas.copiedFrom),
        ),
      )
      .where(eq(schemas.environmentId, environmentId))
      // Un ordre explicite : sans lui, Postgres n'en promet aucun, et la liste
      // se réordonnerait d'une visite à l'autre.
      .orderBy(asc(schemas.name)),
  );

  return rows.map(
    ({
      currentHash,
      libraryId,
      libraryName,
      libraryHash,
      knownToLibrary,
      ...schema
    }) => ({
      ...schema,
      origin:
        libraryId && libraryName
          ? {
              librarySchemaId: libraryId,
              name: libraryName,
              state: originState(currentHash, libraryHash, knownToLibrary),
            }
          : null,
    }),
  );
}

function originState(
  copy: string,
  library: string | null,
  known: boolean,
): OriginState {
  if (copy === library) return "identical";
  return known ? "library_ahead" : "locally_modified";
}

/**
 * ⚠️ **Deux champs ne peuvent pas partager une clé de stockage**, et Postgres
 * n'a rien à opposer à un doublon dans un tableau JSONB. Le refus est donc
 * applicatif, et il est le même à la création qu'à la modification.
 */
function rejectDuplicateField(definition: Definition) {
  const duplicate = duplicateFieldName(definition);
  if (duplicate) {
    throw new SchemaError(409, "duplicate_field", `champ en double : ${duplicate}`);
  }
}

/**
 * Enregistre une version si son contenu est nouveau **dans cette
 * organization**.
 *
 * ⚠️ `ON CONFLICT DO NOTHING` **est** la déduplication : deux schémas qui
 * convergent vers une définition identique partagent une seule ligne, et son
 * `created_at` reste celui de la première apparition.
 */
function storeVersion(
  tx: Transaction,
  organizationId: string,
  hash: string,
  content: VersionedContent,
) {
  return tx
    .insert(schemaVersions)
    .values({
      organizationId,
      hash,
      name: content.name,
      label: content.label ?? null,
      definition: content.definition,
    })
    .onConflictDoNothing();
}

/** Une ligne de journal. Jamais modifiée, jamais supprimée autrement qu'en cascade. */
function appendHistory(
  tx: Transaction,
  entry: {
    organizationId: string;
    schemaId: string;
    hash: string;
    action: HistoryAction;
    actorUserId: string;
  },
) {
  return tx.insert(schemaHistory).values(entry);
}

/**
 * ⚠️ **Le nom est unique dans son environnement**, et la contrainte le dirait
 * en 500. La lire d'abord rend le refus utilisable par l'écran.
 *
 * `exclude` laisse un schéma se heurter à lui-même sans que ce soit un
 * conflit — le cas d'une restauration qui remet le nom déjà porté.
 */
async function rejectDuplicateName(
  tx: Transaction,
  environmentId: string,
  name: string,
  exclude?: string,
) {
  const [clash] = await tx
    .select({ id: schemas.id })
    .from(schemas)
    .where(and(eq(schemas.environmentId, environmentId), eq(schemas.name, name)));

  if (clash && clash.id !== exclude) {
    throw new SchemaError(409, "duplicate_name", `un type nommé ${name} existe`);
  }
}

export async function createSchema(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
  fields: Fields;
}) {
  const { actor, organizationId, environmentId, fields } = input;
  requirePermission(actor, CMS_PERMISSIONS.schemaWrite);
  rejectDuplicateField(fields.definition);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    await rejectDuplicateName(tx, environmentId, fields.name);

    // ⚠️ La version d'abord : `schemas.current_hash` porte une clé étrangère
    // vers elle, donc la ligne de schéma ne peut pas exister avant.
    const hash = fingerprint(fields);
    await storeVersion(tx, organizationId, hash, fields);

    const [created] = await tx
      .insert(schemas)
      .values({ environmentId, organizationId, ...fields, currentHash: hash })
      .returning(columns);
    if (!created) throw new Error("schema insert returned no row");

    // ⚠️ La version initiale et sa ligne de journal font partie de la création.
    // Il n'y a donc rien à rattraper : aucun schéma n'existe sans lignée.
    await appendHistory(tx, {
      organizationId,
      schemaId: created.id,
      hash,
      action: "saved",
      actorUserId: actor.userId,
    });

    return created;
  });
}

/**
 * Copier une entrée de bibliothèque **dans un environnement**.
 *
 * ⚠️ **Jamais « dans un projet »** : un projet ne contient pas de schéma, il
 * contient des environnements. La copie n'existe donc que là où elle a été
 * faite — si le projet gagne un `staging` un jour, **rien ne s'y propage**, y
 * copier sera un geste délibéré de plus (ADR 0018).
 *
 * ⚠️ **Sous le nom de la bibliothèque, sans possibilité de le changer.** Le nom
 * fait partie de l'empreinte : une copie renommée à la naissance se lirait
 * `locally_modified` avant que personne n'y touche. Un nom déjà pris donne donc
 * un 409 qui le nomme, ce qui est plus honnête qu'un diagnostic faux.
 *
 * ⚠️ **Aucune permission nouvelle** : copier crée un type de contenu, donc
 * `schema.write` ; et lire la bibliothèque est `schema.read`. Les deux sont
 * exigées, chacune pour ce qu'elle couvre.
 */
export async function copyFromLibrary(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
  librarySchemaId: string;
}) {
  const { actor, organizationId, environmentId, librarySchemaId } = input;
  requirePermission(actor, CMS_PERMISSIONS.schemaRead);
  requirePermission(actor, CMS_PERMISSIONS.schemaWrite);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [source] = await tx
      .select({
        name: librarySchemas.name,
        label: librarySchemas.label,
        definition: librarySchemas.definition,
        currentHash: librarySchemas.currentHash,
      })
      .from(librarySchemas)
      .where(
        and(
          eq(librarySchemas.id, librarySchemaId),
          eq(librarySchemas.organizationId, organizationId),
        ),
      );
    if (!source) throw new SchemaError(404, "unknown_schema", "introuvable");

    await rejectDuplicateName(tx, environmentId, source.name);

    const { currentHash, ...fields } = source;
    // ⚠️ **Pas de `storeVersion` ici** : la version existe déjà, écrite par la
    // bibliothèque. C'est *tout l'intérêt* de la table partagée — une copie
    // fraîche et sa source pointent la même ligne, donc `identical` est une
    // égalité de chaînes et non un diff.
    const [created] = await tx
      .insert(schemas)
      .values({
        environmentId,
        organizationId,
        ...fields,
        currentHash,
        copiedFrom: librarySchemaId,
      })
      .returning(columns);
    if (!created) throw new Error("schema insert returned no row");

    await appendHistory(tx, {
      organizationId,
      schemaId: created.id,
      hash: currentHash,
      action: "saved",
      actorUserId: actor.userId,
    });

    return created;
  });
}

/**
 * ⚠️ **Le nom se modifie, et c'est délibéré ici** — au niveau du type de
 * contenu, pas du champ. Un champ porte une clé de stockage dans
 * `documents.data`, d'où sa séparation `name` / `label` ; un schéma, lui, n'est
 * référencé que par son identifiant.
 */
export async function updateSchema(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
  schemaId: string;
  fields: Fields;
}) {
  const { actor, organizationId, environmentId, schemaId, fields } = input;
  requirePermission(actor, CMS_PERMISSIONS.schemaWrite);
  rejectDuplicateField(fields.definition);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [before] = await tx
      .select({ ...columns, currentHash: schemas.currentHash })
      .from(schemas)
      .where(and(eq(schemas.id, schemaId), eq(schemas.environmentId, environmentId)));
    if (!before) throw new SchemaError(404, "unknown_schema", "introuvable");

    const { currentHash, ...unchanged } = before;
    const hash = fingerprint(fields);

    /**
     * ⚠️ **No-op complet** quand rien n'a bougé : ni version, ni ligne de
     * journal, ni déplacement — et `updated_at` ne bouge pas non plus.
     *
     * Conséquence sue : le journal enregistre les **changements d'état**, pas
     * les gestes de sauvegarde. Cliquer « enregistrer » sans rien modifier ne
     * laisse aucune trace dans la lignée — un journal de gestes vides serait
     * du bruit. La trace du geste, si elle est un jour voulue, appartient au
     * journal d'audit (ADR 0008).
     */
    if (hash === currentHash) return unchanged;

    await rejectDuplicateName(tx, environmentId, fields.name, schemaId);
    await storeVersion(tx, organizationId, hash, fields);

    const [updated] = await tx
      .update(schemas)
      .set({ ...fields, currentHash: hash, updatedAt: new Date() })
      .where(and(eq(schemas.id, schemaId), eq(schemas.environmentId, environmentId)))
      .returning(columns);
    if (!updated) throw new SchemaError(404, "unknown_schema", "introuvable");

    await appendHistory(tx, {
      organizationId,
      schemaId,
      hash,
      action: "saved",
      actorUserId: actor.userId,
    });

    return updated;
  });
}

/**
 * La lignée d'un schéma, du plus récent au plus ancien.
 *
 * ⚠️ **`seq` ordonne et n'est jamais renvoyée.** C'est de l'ordre, pas de
 * l'information : une séquence globale dirait le volume d'écriture de la
 * plateforme. `created_at` est là pour les humains, mais ne peut pas ordonner —
 * il vaut `now()`, l'horodatage de début de transaction, que deux
 * enregistrements concurrents peuvent partager.
 */
export async function listSchemaHistory(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
  schemaId: string;
}) {
  const { actor, organizationId, environmentId, schemaId } = input;
  requirePermission(actor, CMS_PERMISSIONS.schemaRead);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    // Sans ça, un schéma inexistant et un schéma sans journal se
    // ressembleraient — or l'un est une erreur et l'autre est impossible.
    const [current] = await tx
      .select({ currentHash: schemas.currentHash })
      .from(schemas)
      .where(and(eq(schemas.id, schemaId), eq(schemas.environmentId, environmentId)));
    if (!current) throw new SchemaError(404, "unknown_schema", "introuvable");

    const entries = await tx
      .select({
        hash: schemaHistory.hash,
        action: schemaHistory.action,
        createdAt: schemaHistory.createdAt,
        // ⚠️ Du SQL brut pour `"user"`, comme `listMembers` : la table
        // appartient à Better-Auth, elle n'est pas décrite par Drizzle ici.
        // `leftJoin` parce que `actor_user_id` passe à `NULL` quand le compte
        // s'en va — l'histoire survit aux comptes.
        actorName: sql<string | null>`u.name`,
        actorEmail: sql<string | null>`u.email`,
        // L'état qu'a nommé cette ligne, pour que la lignée se lise sans une
        // requête par entrée.
        name: schemaVersions.name,
        label: schemaVersions.label,
      })
      .from(schemaHistory)
      .innerJoin(
        schemaVersions,
        and(
          eq(schemaVersions.organizationId, schemaHistory.organizationId),
          eq(schemaVersions.hash, schemaHistory.hash),
        ),
      )
      .leftJoin(sql`"user" u`, sql`u.id = ${schemaHistory.actorUserId}`)
      .where(eq(schemaHistory.schemaId, schemaId))
      .orderBy(desc(schemaHistory.seq));

    // ⚠️ Le pointeur voyage avec la lignée. Sans lui, l'écran ne saurait pas
    // quelle entrée est l'état courant — et proposerait de restaurer celle
    // qui y est déjà.
    return { currentHash: current.currentHash, entries };
  });
}

/**
 * Restaurer : **déplacer le pointeur** et ajouter une ligne de journal.
 *
 * ⚠️ **Le journal n'est jamais réécrit.** La ligne ajoutée dit « l'état est
 * redevenu X » ; l'aller-retour A → B → A reste visible, parce que c'est un
 * fait. Et l'empreinte retrouvée est la même ligne de version qu'à la première
 * apparition — une version est un contenu, pas un événement.
 */
export async function restoreSchemaVersion(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
  schemaId: string;
  hash: string;
}) {
  const { actor, organizationId, environmentId, schemaId, hash } = input;
  requirePermission(actor, CMS_PERMISSIONS.schemaWrite);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [current] = await tx
      .select({ ...columns, currentHash: schemas.currentHash })
      .from(schemas)
      .where(and(eq(schemas.id, schemaId), eq(schemas.environmentId, environmentId)));
    if (!current) throw new SchemaError(404, "unknown_schema", "introuvable");

    /**
     * ⚠️ **Un état que *ce* schéma a eu**, pas n'importe quelle version de
     * l'organization. Les versions sont dédupliquées : une empreinte peut
     * exister sans avoir jamais appartenu à ce schéma-ci, et y aller ne serait
     * pas une restauration mais une affectation — ce que la bibliothèque
     * couvre, avec sa propre notion de copie (ADR 0018).
     *
     * La jointure porte les deux questions à la fois : la version existe, et
     * le journal de ce schéma la nomme.
     */
    const [version] = await tx
      .selectDistinct({
        name: schemaVersions.name,
        label: schemaVersions.label,
        definition: schemaVersions.definition,
      })
      .from(schemaVersions)
      .innerJoin(
        schemaHistory,
        and(
          eq(schemaHistory.organizationId, schemaVersions.organizationId),
          eq(schemaHistory.hash, schemaVersions.hash),
        ),
      )
      .where(
        and(
          eq(schemaVersions.organizationId, organizationId),
          eq(schemaVersions.hash, hash),
          eq(schemaHistory.schemaId, schemaId),
        ),
      );
    if (!version) {
      throw new SchemaError(404, "unknown_version", `version inconnue : ${hash}`);
    }

    const { currentHash, ...unchanged } = current;
    // Déjà là. Même raison qu'à l'enregistrement : rien n'a changé d'état.
    if (hash === currentHash) return unchanged;

    // ⚠️ Le nom fait partie de la version, donc le remettre peut heurter un
    // schéma créé entre-temps sous cet ancien nom.
    await rejectDuplicateName(tx, environmentId, version.name, schemaId);

    const [restored] = await tx
      .update(schemas)
      .set({ ...version, currentHash: hash, updatedAt: new Date() })
      .where(and(eq(schemas.id, schemaId), eq(schemas.environmentId, environmentId)))
      .returning(columns);
    if (!restored) throw new SchemaError(404, "unknown_schema", "introuvable");

    await appendHistory(tx, {
      organizationId,
      schemaId,
      hash,
      action: "restored",
      actorUserId: actor.userId,
    });

    return restored;
  });
}

/**
 * ⚠️ **Les versions survivent au schéma.** Le journal part en cascade avec lui,
 * mais les lignes de `schema_versions` restent : elles sont du contenu partagé
 * par organization, et un autre schéma peut pointer sur la même. C'est ce que
 * fait Git de ses blobs, et pour la même raison.
 */
export async function deleteSchema(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
  schemaId: string;
}) {
  const { actor, organizationId, environmentId, schemaId } = input;
  requirePermission(actor, CMS_PERMISSIONS.schemaWrite);

  await withContext({ userId: actor.userId, organizationId }, async (tx) => {
    /**
     * ⚠️ **Compter avant, plutôt que buter sur la clé.** `documents_schema_fk`
     * est en `RESTRICT` : sans ce contrôle, supprimer un type qui porte des
     * entries remonterait en 500 au lieu de dire ce qui bloque. C'est la règle
     * de partout ici — révoquer une clé avant de la supprimer, vider une
     * organization avant de l'effacer : **le refus compte ce qui reste**.
     */
    const [held] = await tx
      .select({ entries: count() })
      .from(documents)
      .where(eq(documents.schemaId, schemaId));
    if (held && held.entries > 0) {
      throw new SchemaError(
        409,
        "schema_in_use",
        `${held.entries} document(s) utilisent encore ce type`,
      );
    }

    const deleted = await tx
      .delete(schemas)
      .where(and(eq(schemas.id, schemaId), eq(schemas.environmentId, environmentId)))
      .returning({ id: schemas.id });
    if (deleted.length === 0) {
      throw new SchemaError(404, "unknown_schema", "introuvable");
    }
  });
}
