import { and, asc, eq } from "drizzle-orm";
import type { Actor } from "../auth/authorization.ts";
import { requirePermission } from "../auth/escalation.ts";
import { withContext } from "../db/client.ts";
import { ServiceError } from "../services/service-error.ts";
import { type Definition, duplicateFieldName } from "./definition.ts";
import { CMS_PERMISSIONS } from "./permissions.ts";
import { schemas } from "./schema.ts";

/**
 * Les types de contenu d'un environnement.
 *
 * ⚠️ **Rien n'est versionné ici.** L'identité d'une version est le hachage de
 * sa définition normalisée, et ça arrive à l'étape suivante
 * ([ADR 0016](../../../docs/adr/0016-versionnage-des-schemas-adresse-par-contenu.md)).
 * Poser dès maintenant une colonne `current_hash` sans mécanisme derrière
 * serait une colonne sans signification.
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

export function listSchemas(
  actor: Actor,
  organizationId: string,
  environmentId: string,
) {
  requirePermission(actor, CMS_PERMISSIONS.schemaRead);

  return withContext({ userId: actor.userId, organizationId }, (tx) =>
    tx
      .select(columns)
      .from(schemas)
      .where(eq(schemas.environmentId, environmentId))
      // Un ordre explicite : sans lui, Postgres n'en promet aucun, et la liste
      // se réordonnerait d'une visite à l'autre.
      .orderBy(asc(schemas.name)),
  );
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
    const existing = await tx
      .select({ id: schemas.id })
      .from(schemas)
      .where(
        and(eq(schemas.environmentId, environmentId), eq(schemas.name, fields.name)),
      );
    if (existing.length > 0) {
      // La contrainte d'unicité dirait la même chose, en 500. La lire d'abord
      // rend le refus utilisable par l'écran.
      throw new SchemaError(
        409,
        "duplicate_name",
        `un type nommé ${fields.name} existe`,
      );
    }

    const [created] = await tx
      .insert(schemas)
      .values({ environmentId, organizationId, ...fields })
      .returning(columns);
    if (!created) throw new Error("schema insert returned no row");
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
    const [updated] = await tx
      .update(schemas)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(schemas.id, schemaId), eq(schemas.environmentId, environmentId)))
      .returning(columns);
    if (!updated) throw new SchemaError(404, "unknown_schema", "introuvable");
    return updated;
  });
}

export async function deleteSchema(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
  schemaId: string;
}) {
  const { actor, organizationId, environmentId, schemaId } = input;
  requirePermission(actor, CMS_PERMISSIONS.schemaWrite);

  await withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const deleted = await tx
      .delete(schemas)
      .where(and(eq(schemas.id, schemaId), eq(schemas.environmentId, environmentId)))
      .returning({ id: schemas.id });
    if (deleted.length === 0) {
      throw new SchemaError(404, "unknown_schema", "introuvable");
    }
  });
}
