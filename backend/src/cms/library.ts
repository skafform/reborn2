import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Actor } from "../auth/authorization.ts";
import { requirePermission } from "../auth/escalation.ts";
import { type Transaction, withContext } from "../db/client.ts";
import { type Definition, duplicateFieldName } from "./definition.ts";
import { fingerprint, type VersionedContent } from "./fingerprint.ts";
import { CMS_PERMISSIONS } from "./permissions.ts";
import {
  type HistoryAction,
  librarySchemaHistory,
  librarySchemas,
  schemaVersions,
} from "./schema.ts";
import { SchemaError } from "./schemas.ts";

/**
 * La bibliothèque de schémas d'une organization
 * ([ADR 0018](../../../docs/adr/0018-bibliotheque-de-schemas-table-separee.md)).
 *
 * ⚠️ **Les mêmes gestes que `schemas.ts`, écrits explicitement**, et non un
 * gestionnaire de versions paramétré par table. Ce qu'il faudrait paramétrer —
 * table portante, colonne de rattachement, table de journal — coûterait plus à
 * lire que ces deux versions, et les deux cas divergent déjà : une bibliothèque
 * n'a pas d'environnement, son unicité de nom porte sur l'organization, et elle
 * n'aura jamais de documents.
 *
 * ⚠️ **Ce qui *est* partagé l'est parce que c'est le même objet** :
 * `fingerprint` et la table `schema_versions`. Le diagnostic de divergence
 * demande « le hachage de la copie est-il dans l'historique de la
 * bibliothèque ? » — question qui n'a de sens que si les deux nomment les mêmes
 * lignes de version.
 */

type Fields = { name: string; label: string | null; definition: Definition };

const columns = {
  id: librarySchemas.id,
  name: librarySchemas.name,
  label: librarySchemas.label,
  definition: librarySchemas.definition,
  createdAt: librarySchemas.createdAt,
  updatedAt: librarySchemas.updatedAt,
};

function rejectDuplicateField(definition: Definition) {
  const duplicate = duplicateFieldName(definition);
  if (duplicate) {
    throw new SchemaError(409, "duplicate_field", `champ en double : ${duplicate}`);
  }
}

/**
 * ⚠️ **L'unicité du nom porte sur l'organization**, là où celle de `schemas`
 * porte sur l'environnement. C'est la première divergence des deux formes.
 */
async function rejectDuplicateName(
  tx: Transaction,
  organizationId: string,
  name: string,
  exclude?: string,
) {
  const [clash] = await tx
    .select({ id: librarySchemas.id })
    .from(librarySchemas)
    .where(
      and(
        eq(librarySchemas.organizationId, organizationId),
        eq(librarySchemas.name, name),
      ),
    );

  if (clash && clash.id !== exclude) {
    throw new SchemaError(409, "duplicate_name", `un schéma nommé ${name} existe`);
  }
}

/** Voir `storeVersion` dans `schemas.ts` — même table, même déduplication. */
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

function appendHistory(
  tx: Transaction,
  entry: {
    organizationId: string;
    librarySchemaId: string;
    hash: string;
    action: HistoryAction;
    actorUserId: string;
  },
) {
  return tx.insert(librarySchemaHistory).values(entry);
}

/**
 * ⚠️ **Lire la bibliothèque, c'est `schema.read`**, jamais `library.write`.
 * Tout membre qui peut voir un type de contenu peut voir ce dans quoi son
 * organization propose de piocher ; seule la curation a sa propre clé.
 */
export function listLibrarySchemas(actor: Actor, organizationId: string) {
  requirePermission(actor, CMS_PERMISSIONS.schemaRead);

  return withContext({ userId: actor.userId, organizationId }, (tx) =>
    tx
      .select({ ...columns, currentHash: librarySchemas.currentHash })
      .from(librarySchemas)
      .where(eq(librarySchemas.organizationId, organizationId))
      .orderBy(asc(librarySchemas.name)),
  );
}

export async function createLibrarySchema(input: {
  actor: Actor;
  organizationId: string;
  fields: Fields;
}) {
  const { actor, organizationId, fields } = input;
  requirePermission(actor, CMS_PERMISSIONS.libraryWrite);
  rejectDuplicateField(fields.definition);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    await rejectDuplicateName(tx, organizationId, fields.name);

    const hash = fingerprint(fields);
    await storeVersion(tx, organizationId, hash, fields);

    const [created] = await tx
      .insert(librarySchemas)
      .values({ organizationId, ...fields, currentHash: hash })
      .returning(columns);
    if (!created) throw new Error("library schema insert returned no row");

    await appendHistory(tx, {
      organizationId,
      librarySchemaId: created.id,
      hash,
      action: "saved",
      actorUserId: actor.userId,
    });

    return created;
  });
}

export async function updateLibrarySchema(input: {
  actor: Actor;
  organizationId: string;
  librarySchemaId: string;
  fields: Fields;
}) {
  const { actor, organizationId, librarySchemaId, fields } = input;
  requirePermission(actor, CMS_PERMISSIONS.libraryWrite);
  rejectDuplicateField(fields.definition);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [before] = await tx
      .select({ ...columns, currentHash: librarySchemas.currentHash })
      .from(librarySchemas)
      .where(
        and(
          eq(librarySchemas.id, librarySchemaId),
          eq(librarySchemas.organizationId, organizationId),
        ),
      );
    if (!before) throw new SchemaError(404, "unknown_schema", "introuvable");

    const { currentHash, ...unchanged } = before;
    const hash = fingerprint(fields);
    // No-op complet, même raison que pour un type de contenu : le journal
    // enregistre les changements d'état, pas les gestes de sauvegarde.
    if (hash === currentHash) return unchanged;

    await rejectDuplicateName(tx, organizationId, fields.name, librarySchemaId);
    await storeVersion(tx, organizationId, hash, fields);

    const [updated] = await tx
      .update(librarySchemas)
      .set({ ...fields, currentHash: hash, updatedAt: new Date() })
      .where(eq(librarySchemas.id, librarySchemaId))
      .returning(columns);
    if (!updated) throw new SchemaError(404, "unknown_schema", "introuvable");

    await appendHistory(tx, {
      organizationId,
      librarySchemaId,
      hash,
      action: "saved",
      actorUserId: actor.userId,
    });

    return updated;
  });
}

export async function listLibrarySchemaHistory(input: {
  actor: Actor;
  organizationId: string;
  librarySchemaId: string;
}) {
  const { actor, organizationId, librarySchemaId } = input;
  requirePermission(actor, CMS_PERMISSIONS.schemaRead);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [current] = await tx
      .select({ currentHash: librarySchemas.currentHash })
      .from(librarySchemas)
      .where(
        and(
          eq(librarySchemas.id, librarySchemaId),
          eq(librarySchemas.organizationId, organizationId),
        ),
      );
    if (!current) throw new SchemaError(404, "unknown_schema", "introuvable");

    const entries = await tx
      .select({
        hash: librarySchemaHistory.hash,
        action: librarySchemaHistory.action,
        createdAt: librarySchemaHistory.createdAt,
        actorName: sql<string | null>`u.name`,
        actorEmail: sql<string | null>`u.email`,
        name: schemaVersions.name,
        label: schemaVersions.label,
      })
      .from(librarySchemaHistory)
      .innerJoin(
        schemaVersions,
        and(
          eq(schemaVersions.organizationId, librarySchemaHistory.organizationId),
          eq(schemaVersions.hash, librarySchemaHistory.hash),
        ),
      )
      .leftJoin(sql`"user" u`, sql`u.id = ${librarySchemaHistory.actorUserId}`)
      .where(eq(librarySchemaHistory.librarySchemaId, librarySchemaId))
      .orderBy(desc(librarySchemaHistory.seq));

    return { currentHash: current.currentHash, entries };
  });
}

export async function restoreLibrarySchemaVersion(input: {
  actor: Actor;
  organizationId: string;
  librarySchemaId: string;
  hash: string;
}) {
  const { actor, organizationId, librarySchemaId, hash } = input;
  requirePermission(actor, CMS_PERMISSIONS.libraryWrite);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [current] = await tx
      .select({ ...columns, currentHash: librarySchemas.currentHash })
      .from(librarySchemas)
      .where(
        and(
          eq(librarySchemas.id, librarySchemaId),
          eq(librarySchemas.organizationId, organizationId),
        ),
      );
    if (!current) throw new SchemaError(404, "unknown_schema", "introuvable");

    // ⚠️ Un état que *ce* schéma a eu. Les versions sont partagées par toute
    // l'organization — un type de contenu de projet peut avoir écrit celle-ci —
    // donc sans le journal, « restaurer » deviendrait « prendre le modèle
    // d'ailleurs ».
    const [version] = await tx
      .selectDistinct({
        name: schemaVersions.name,
        label: schemaVersions.label,
        definition: schemaVersions.definition,
      })
      .from(schemaVersions)
      .innerJoin(
        librarySchemaHistory,
        and(
          eq(librarySchemaHistory.organizationId, schemaVersions.organizationId),
          eq(librarySchemaHistory.hash, schemaVersions.hash),
        ),
      )
      .where(
        and(
          eq(schemaVersions.organizationId, organizationId),
          eq(schemaVersions.hash, hash),
          eq(librarySchemaHistory.librarySchemaId, librarySchemaId),
        ),
      );
    if (!version) {
      throw new SchemaError(404, "unknown_version", `version inconnue : ${hash}`);
    }

    const { currentHash, ...unchanged } = current;
    if (hash === currentHash) return unchanged;

    await rejectDuplicateName(tx, organizationId, version.name, librarySchemaId);

    const [restored] = await tx
      .update(librarySchemas)
      .set({ ...version, currentHash: hash, updatedAt: new Date() })
      .where(eq(librarySchemas.id, librarySchemaId))
      .returning(columns);
    if (!restored) throw new SchemaError(404, "unknown_schema", "introuvable");

    await appendHistory(tx, {
      organizationId,
      librarySchemaId,
      hash,
      action: "restored",
      actorUserId: actor.userId,
    });

    return restored;
  });
}

/**
 * ⚠️ **Supprimer une entrée de bibliothèque ne touche aucune copie.** Les
 * copies sont indépendantes par construction (ADR 0018) ; ce qu'elles perdent
 * est leur provenance, donc le diagnostic de divergence — pas leur définition.
 */
export async function deleteLibrarySchema(input: {
  actor: Actor;
  organizationId: string;
  librarySchemaId: string;
}) {
  const { actor, organizationId, librarySchemaId } = input;
  requirePermission(actor, CMS_PERMISSIONS.libraryWrite);

  await withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const deleted = await tx
      .delete(librarySchemas)
      .where(
        and(
          eq(librarySchemas.id, librarySchemaId),
          eq(librarySchemas.organizationId, organizationId),
        ),
      )
      .returning({ id: librarySchemas.id });
    if (deleted.length === 0) {
      throw new SchemaError(404, "unknown_schema", "introuvable");
    }
  });
}
