import { and, asc, eq, sql } from "drizzle-orm";
import type { Actor } from "../auth/authorization.ts";
import { requirePermission } from "../auth/escalation.ts";
import { type Transaction, withContext } from "../db/client.ts";
import { ServiceError } from "../services/service-error.ts";
import type { DocumentData } from "./definition.ts";
import { documentFingerprint } from "./fingerprint.ts";
import { CMS_PERMISSIONS } from "./permissions.ts";
import { documents, documentVersions, schemas } from "./schema.ts";
import { documentValidators } from "./validate.ts";

/**
 * Les documents d'un environnement : une ligne, deux pointeurs, aucun statut
 * stocké ([ADR 0022](../../../docs/adr/0022-document-a-deux-pointeurs.md)).
 *
 * ⚠️ **Ce module ne publie pas encore.** `published_hash` existe et sa clé
 * étrangère aussi, mais seul le jalon suivant le déplace — donc tout document
 * est ici un brouillon, et « abandonner les modifications » n'aurait rien à
 * abandonner. Ce qui vit ici : créer, enregistrer, lister, supprimer, et le
 * **nettoyage synchrone** qui accompagne les deux derniers.
 */

export class DocumentError extends ServiceError {
  declare readonly status: 404 | 409 | 422;
}

const columns = {
  id: documents.id,
  schemaId: documents.schemaId,
  data: documents.data,
  currentHash: documents.currentHash,
  publishedHash: documents.publishedHash,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
};

/**
 * La définition **courante** du type, et la validation de forme contre elle.
 *
 * ⚠️ **Courante, jamais celle sous laquelle le document a été écrit.** Un
 * document se remet en conformité à sa prochaine écriture
 * ([ADR 0017](../../../docs/adr/0017-validation-a-l-ecriture-seulement.md)) ;
 * valider contre une version figée ferait exactement l'inverse.
 */
async function validateShape(
  tx: Transaction,
  environmentId: string,
  schemaId: string,
  data: DocumentData,
) {
  const [schema] = await tx
    .select({ definition: schemas.definition })
    .from(schemas)
    .where(and(eq(schemas.id, schemaId), eq(schemas.environmentId, environmentId)));
  if (!schema) {
    throw new DocumentError(404, "unknown_schema", "type de contenu introuvable");
  }

  const result = documentValidators(schema.definition).shape.safeParse(data);
  if (!result.success) {
    // 422 et non 400 : le corps est bien formé, c'est sa conformité au type
    // de contenu qui est en cause — Zod occupe déjà le 400 à la frontière.
    const named = result.error.issues
      .map((issue) => issue.path.join(".") || "(racine)")
      .join(", ");
    throw new DocumentError(422, "invalid_document", `champs refusés : ${named}`);
  }
}

/** Le contenu est nouveau **dans cette organization**, ou il ne l'est pas. */
function storeVersion(
  tx: Transaction,
  organizationId: string,
  hash: string,
  data: DocumentData,
) {
  return tx
    .insert(documentVersions)
    .values({ organizationId, hash, data })
    .onConflictDoNothing();
}

/** Le code Postgres d'une violation de clé étrangère. */
const FOREIGN_KEY_VIOLATION = "23503";

const isForeignKeyViolation = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === FOREIGN_KEY_VIOLATION;

/**
 * Oublie une version dès que plus aucun pointeur de l'organization ne la
 * nomme — **dans la transaction d'écriture**, jamais dans un balayage différé.
 *
 * ⚠️ **Pourquoi synchrone.** Chaque enregistrement rend une version orpheline,
 * et le contenu change des ordres de grandeur plus souvent que les schémas —
 * l'argument même qui a écarté un journal de documents. Un « GC plus tard »
 * sur une croissance non bornée n'est pas un report, c'est une dette qui
 * grossit au rythme de l'usage.
 *
 * ⚠️ **Deux mécanismes, et chacun gagne sa place.** Le `NOT EXISTS` traite le
 * cas courant sans lever — au premier remaniement d'un document publié,
 * l'ancien `current_hash` est encore le `published_hash` de la même ligne, et
 * un `DELETE` nu lèverait alors à *chaque* sauvegarde : l'exception comme flux
 * normal. La clé étrangère, elle, traite la course : entre l'évaluation et la
 * suppression, un autre document a pu reprendre l'empreinte.
 *
 * ⚠️ **La course perdue est un succès, et le `SAVEPOINT` est ce qui le permet.**
 * Une erreur Postgres avorte la transaction entière ; sans transaction
 * imbriquée, avaler le refus laisserait une transaction morte, et
 * l'enregistrement qu'on venait de faire partirait avec. La version est
 * référencée, donc elle doit vivre — c'est le système qui fonctionne.
 */
async function forgetVersion(tx: Transaction, organizationId: string, hash: string) {
  try {
    await tx.transaction(async (nested) => {
      await nested.execute(sql`
        delete from document_versions v
         where v.organization_id = ${organizationId}::uuid
           and v.hash = ${hash}
           and not exists (
             select 1
               from documents d
              where d.organization_id = v.organization_id
                and (d.current_hash = v.hash or d.published_hash = v.hash)
           )`);
    });
  } catch (error) {
    if (!isForeignKeyViolation(error)) throw error;
  }
}

export function listDocuments(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
  schemaId?: string;
}) {
  const { actor, organizationId, environmentId, schemaId } = input;
  // ⚠️ `content.read_draft`, pas `content.read` : cette liste est celle de la
  // console, qui montre les brouillons. La lecture du seul publié appartient à
  // l'API de livraison.
  requirePermission(actor, CMS_PERMISSIONS.contentReadDraft);

  return withContext({ userId: actor.userId, organizationId }, (tx) =>
    tx
      .select(columns)
      .from(documents)
      .where(
        and(
          eq(documents.environmentId, environmentId),
          schemaId ? eq(documents.schemaId, schemaId) : undefined,
        ),
      )
      // Un ordre explicite : sans lui, Postgres n'en promet aucun.
      .orderBy(asc(documents.createdAt), asc(documents.id)),
  );
}

export async function createDocument(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
  schemaId: string;
  data: DocumentData;
}) {
  const { actor, organizationId, environmentId, schemaId, data } = input;
  requirePermission(actor, CMS_PERMISSIONS.contentWrite);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    await validateShape(tx, environmentId, schemaId, data);

    // ⚠️ La version d'abord : `current_hash` porte une clé étrangère vers elle.
    const hash = documentFingerprint(data);
    await storeVersion(tx, organizationId, hash, data);

    const [created] = await tx
      .insert(documents)
      .values({ environmentId, organizationId, schemaId, data, currentHash: hash })
      .returning(columns);
    if (!created) throw new Error("document insert returned no row");
    return created;
  });
}

/**
 * Enregistrer : déplacer `current_hash`, et oublier ce que plus rien ne nomme.
 *
 * ⚠️ **No-op complet** quand l'empreinte n'a pas bougé — ni version, ni
 * déplacement, ni `updated_at`. Le même geste que pour un schéma, et la même
 * raison : ce qui est enregistré est un **changement d'état**, pas une frappe.
 */
export async function updateDocument(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
  documentId: string;
  data: DocumentData;
}) {
  const { actor, organizationId, environmentId, documentId, data } = input;
  requirePermission(actor, CMS_PERMISSIONS.contentWrite);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [before] = await tx
      .select(columns)
      .from(documents)
      .where(
        and(eq(documents.id, documentId), eq(documents.environmentId, environmentId)),
      );
    if (!before) throw new DocumentError(404, "unknown_document", "introuvable");

    await validateShape(tx, environmentId, before.schemaId, data);

    const hash = documentFingerprint(data);
    if (hash === before.currentHash) return before;

    await storeVersion(tx, organizationId, hash, data);

    const [updated] = await tx
      .update(documents)
      .set({ data, currentHash: hash, updatedAt: new Date() })
      .where(eq(documents.id, documentId))
      .returning(columns);
    if (!updated) throw new DocumentError(404, "unknown_document", "introuvable");

    // ⚠️ **Après le déplacement**, jamais avant : c'est ce qui rend l'ancienne
    // empreinte réellement inatteignable au moment où on la teste.
    await forgetVersion(tx, organizationId, before.currentHash);

    return updated;
  });
}

/**
 * ⚠️ **Supprimer un document oublie ses deux versions**, sinon chaque
 * suppression laisserait un ou deux payloads que rien ne pourra plus jamais
 * atteindre — la même croissance non bornée, prise par l'autre bout.
 */
export async function deleteDocument(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
  documentId: string;
}) {
  const { actor, organizationId, environmentId, documentId } = input;
  requirePermission(actor, CMS_PERMISSIONS.contentWrite);

  await withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [deleted] = await tx
      .delete(documents)
      .where(
        and(eq(documents.id, documentId), eq(documents.environmentId, environmentId)),
      )
      .returning({
        currentHash: documents.currentHash,
        publishedHash: documents.publishedHash,
      });
    if (!deleted) throw new DocumentError(404, "unknown_document", "introuvable");

    await forgetVersion(tx, organizationId, deleted.currentHash);
    if (deleted.publishedHash && deleted.publishedHash !== deleted.currentHash) {
      await forgetVersion(tx, organizationId, deleted.publishedHash);
    }
  });
}
