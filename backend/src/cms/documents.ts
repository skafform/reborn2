import { and, asc, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import type { Actor } from "../auth/authorization.ts";
import { requirePermission } from "../auth/escalation.ts";
import { type Transaction, withContext } from "../db/client.ts";
import { ServiceError } from "../services/service-error.ts";
import type { Definition, DocumentData } from "./definition.ts";
import { documentFingerprint } from "./fingerprint.ts";
import { CMS_PERMISSIONS } from "./permissions.ts";
import { documentReferences, documents, documentVersions, schemas } from "./schema.ts";
import { documentValidators } from "./validate.ts";

/**
 * Les documents d'un environnement : une ligne, deux pointeurs, aucun statut
 * stocké ([ADR 0022](../../../docs/adr/0022-document-a-deux-pointeurs.md)).
 *
 * Créer, enregistrer, lister, supprimer, publier, dépublier, abandonner — et
 * le **nettoyage synchrone** qui accompagne chaque déplacement de pointeur.
 *
 * Les **références** y vivent aussi : la valeur qui fait foi est l'UUID dans
 * `data`, `document_references` en est l'index **dérivé**, réécrit dans la même
 * transaction, et l'invariant de clôture — *ce qui est publié ne pointe que
 * vers du publié* — garde les deux portes de la publication
 * ([ADR 0020](../../../docs/adr/0020-references-entre-documents.md),
 * [ADR 0021](../../../docs/adr/0021-ensemble-publie-clos-par-reference.md)).
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

  return schema.definition;
}

/** Les champs `reference` d'une définition, et le type que chacun vise. */
const referenceFields = (definition: Definition) =>
  definition.fields.filter(
    (field): field is (typeof definition.fields)[number] & { to: string } =>
      field.type === "reference" && typeof field.to === "string",
  );

/**
 * Ce que le `data` d'un document pointe : la cible **existe**, elle est du
 * **type nommé par `to`**, et elle vit dans le même environnement.
 *
 * ⚠️ **La clé composite n'en garantit que deux sur trois.** L'existence et
 * l'environnement sont tenus par la forme ; que la cible soit du bon type ne
 * l'est pas — un `data` peut nommer un `author` là où le champ demande un
 * `article`, et rien dans le schéma de base ne s'y oppose. C'est donc un
 * contrôle applicatif, et c'est le seul des trois qui en soit un.
 */
async function resolveReferences(
  tx: Transaction,
  environmentId: string,
  definition: Definition,
  data: DocumentData,
) {
  const wanted = referenceFields(definition)
    .map((field) => ({ field: field.name, to: field.to, target: data[field.name] }))
    .filter(
      (entry): entry is typeof entry & { target: string } =>
        typeof entry.target === "string",
    );
  if (wanted.length === 0) return [];

  const found = await tx
    .select({ id: documents.id, type: schemas.name })
    .from(documents)
    .innerJoin(schemas, eq(schemas.id, documents.schemaId))
    .where(
      and(
        eq(documents.environmentId, environmentId),
        inArray(
          documents.id,
          wanted.map((entry) => entry.target),
        ),
      ),
    );
  const types = new Map(found.map((row) => [row.id, row.type]));

  for (const entry of wanted) {
    const actual = types.get(entry.target);
    if (!actual) {
      throw new DocumentError(
        422,
        "unknown_reference",
        `${entry.field} : aucun document ${entry.target} dans cet environnement`,
      );
    }
    if (actual !== entry.to) {
      throw new DocumentError(
        422,
        "wrong_reference_type",
        `${entry.field} : attendait un ${entry.to}, a reçu un ${actual}`,
      );
    }
  }

  return wanted.map((entry) => ({ fieldName: entry.field, target: entry.target }));
}

/**
 * Réécrit l'index d'un document : ses lignes disparaissent, puis renaissent
 * depuis son `data` — **dans la transaction d'écriture**, jamais après.
 *
 * ⚠️ Les deux réussissent ou aucune. Pas de tâche de fond, pas de cohérence à
 * terme, pas de synchronisation entre systèmes : c'est ce qu'un seul Postgres
 * achète, et on le prend (ADR 0020).
 */
async function syncReferences(
  tx: Transaction,
  scope: { organizationId: string; environmentId: string; sourceDocumentId: string },
  links: readonly { fieldName: string; target: string }[],
) {
  await tx
    .delete(documentReferences)
    .where(eq(documentReferences.sourceDocumentId, scope.sourceDocumentId));

  if (links.length === 0) return;
  await tx.insert(documentReferences).values(
    links.map((link) => ({
      organizationId: scope.organizationId,
      environmentId: scope.environmentId,
      sourceDocumentId: scope.sourceDocumentId,
      targetDocumentId: link.target,
      fieldName: link.fieldName,
    })),
  );
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
  /** Filtrer par type de contenu, ou tout rendre. */
  schemaId?: string | undefined;
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
    const definition = await validateShape(tx, environmentId, schemaId, data);
    const links = await resolveReferences(tx, environmentId, definition, data);

    // ⚠️ La version d'abord : `current_hash` porte une clé étrangère vers elle.
    const hash = documentFingerprint(data);
    await storeVersion(tx, organizationId, hash, data);

    const [created] = await tx
      .insert(documents)
      .values({ environmentId, organizationId, schemaId, data, currentHash: hash })
      .returning(columns);
    if (!created) throw new Error("document insert returned no row");

    await syncReferences(
      tx,
      { organizationId, environmentId, sourceDocumentId: created.id },
      links,
    );
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

    const definition = await validateShape(tx, environmentId, before.schemaId, data);
    const links = await resolveReferences(tx, environmentId, definition, data);

    const hash = documentFingerprint(data);
    if (hash === before.currentHash) return before;

    await storeVersion(tx, organizationId, hash, data);
    await syncReferences(
      tx,
      { organizationId, environmentId, sourceDocumentId: documentId },
      links,
    );

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
 * ⚠️ **`RESTRICT` sans ses manières serait un 409 nu.** La contrainte refuse
 * déjà la suppression d'une cible référencée ; ce que l'application ajoute est
 * de **nommer ce qui pointe** — c'est la règle de partout ici, et l'index rend
 * cette liste triviale à produire. C'est même sa seule raison d'exister
 * ([ADR 0020](../../../docs/adr/0020-references-entre-documents.md)).
 */
async function rejectReferencedTarget(tx: Transaction, documentId: string) {
  const referrers = await tx
    .select({
      documentId: documentReferences.sourceDocumentId,
      contentTypeId: documents.schemaId,
      fieldName: documentReferences.fieldName,
    })
    .from(documentReferences)
    .innerJoin(documents, eq(documents.id, documentReferences.sourceDocumentId))
    .where(eq(documentReferences.targetDocumentId, documentId));

  if (referrers.length > 0) {
    throw new DocumentError(
      409,
      "referenced",
      `référencé par ${referrers.length} document(s)`,
      { references: referrers },
    );
  }
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
    await rejectReferencedTarget(tx, documentId);

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

/**
 * Reconstruit l'index d'un environnement en rebalayant ses documents.
 *
 * ⚠️ **C'est ce qui rend « dette réparable » réel plutôt que théorique**
 * (ADR 0020). `data` fait foi ; si l'index dérivait — un défaut, une écriture
 * hors du chemin prévu — cette routine le remet d'accord sans qu'aucune donnée
 * ne soit perdue. C'est toute la différence entre un index dérivé et un index
 * autoritaire.
 *
 * ⚠️ **Aucune route ne l'expose, et c'est délibéré** : l'exploitation est un
 * geste local, jamais un chemin transverse dans l'application publique
 * ([ADR 0015](../../../docs/adr/0015-exploitation-hors-ligne-jamais-dans-l-application.md)).
 */
export async function rebuildReferenceIndex(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
}) {
  const { actor, organizationId, environmentId } = input;
  requirePermission(actor, CMS_PERMISSIONS.contentWrite);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const rows = await tx
      .select({
        id: documents.id,
        data: documents.data,
        definition: schemas.definition,
      })
      .from(documents)
      .innerJoin(schemas, eq(schemas.id, documents.schemaId))
      .where(eq(documents.environmentId, environmentId));

    let links = 0;
    for (const row of rows) {
      const found = referenceFields(row.definition)
        .map((field) => ({ fieldName: field.name, target: row.data[field.name] }))
        .filter(
          (link): link is { fieldName: string; target: string } =>
            typeof link.target === "string",
        );
      await syncReferences(
        tx,
        { organizationId, environmentId, sourceDocumentId: row.id },
        found,
      );
      links += found.length;
    }
    return { documents: rows.length, links };
  });
}

/**
 * L'état de publication, **dérivé** de la comparaison des deux pointeurs
 * (ADR 0022). Jamais stocké : une colonne `status` ne pourrait pas exprimer
 * *changed*, qui est le cas central du travail éditorial.
 */
export const DOCUMENT_STATES = ["draft", "published", "changed"] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

export function documentState(
  currentHash: string,
  publishedHash: string | null,
): DocumentState {
  if (!publishedHash) return "draft";
  return publishedHash === currentHash ? "published" : "changed";
}

/**
 * ⚠️ **La complétude, et elle seule, appartient à ce moment.** La forme a été
 * vérifiée à l'enregistrement ; ce qui est demandé ici, c'est qu'un champ
 * requis soit renseigné — mais le validateur de complétude **inclut** la
 * forme, parce qu'un brouillon écrit sous une définition antérieure doit
 * repasser la définition courante avant d'être servi au public
 * ([ADR 0017](../../../docs/adr/0017-validation-a-l-ecriture-seulement.md)).
 */
async function rejectIncomplete(
  tx: Transaction,
  environmentId: string,
  entries: readonly { id: string; schemaId: string; data: DocumentData }[],
) {
  for (const entry of entries) {
    const [schema] = await tx
      .select({ definition: schemas.definition })
      .from(schemas)
      .where(
        and(eq(schemas.id, entry.schemaId), eq(schemas.environmentId, environmentId)),
      );
    if (!schema) {
      throw new DocumentError(404, "unknown_schema", "type de contenu introuvable");
    }

    const result = documentValidators(schema.definition).completeness.safeParse(
      entry.data,
    );
    if (!result.success) {
      const named = result.error.issues
        .map((issue) => issue.path.join(".") || "(racine)")
        .join(", ");
      throw new DocumentError(
        422,
        "incomplete_document",
        `${entry.id} : champs manquants ou refusés — ${named}`,
      );
    }
  }
}

/**
 * **Ce qui est publié ne pointe que vers du publié**
 * ([ADR 0021](../../../docs/adr/0021-ensemble-publie-clos-par-reference.md)).
 * Un invariant, énoncé une fois — les deux vérifications en découlent.
 *
 * ⚠️ **Le contrôle porte sur une transition d'ensemble**, jamais sur un
 * document isolé, même quand l'ensemble n'a qu'un membre : deux documents qui
 * se référencent mutuellement ne peuvent être publiés qu'ensemble, et
 * l'écrire au singulier rendrait ça impossible.
 */
async function rejectUnclosedPublication(
  tx: Transaction,
  publishing: readonly string[],
) {
  const dangling = await tx
    .select({
      documentId: documentReferences.targetDocumentId,
      contentTypeId: documents.schemaId,
      fieldName: documentReferences.fieldName,
      fromDocumentId: documentReferences.sourceDocumentId,
    })
    .from(documentReferences)
    .innerJoin(documents, eq(documents.id, documentReferences.targetDocumentId))
    .where(
      and(
        inArray(documentReferences.sourceDocumentId, [...publishing]),
        // Publiée après la transition, c'est : déjà publiée, **ou** publiée
        // par ce geste-ci. La seconde moitié est ce que l'ensemble achète.
        isNull(documents.publishedHash),
        notInArray(documents.id, [...publishing]),
      ),
    );

  if (dangling.length > 0) {
    throw new DocumentError(
      409,
      "references_unpublished",
      `pointe vers ${dangling.length} document(s) non publié(s)`,
      { references: dangling },
    );
  }
}

/**
 * L'autre porte du même invariant — celle qu'une formulation en règle aurait
 * manquée. « Ne pas publier contre un brouillon » ne dit rien de la
 * dépublication, et c'est pourtant le même trou par l'autre bout.
 */
async function rejectUnclosedUnpublication(
  tx: Transaction,
  unpublishing: readonly string[],
) {
  const orphaning = await tx
    .select({
      documentId: documentReferences.sourceDocumentId,
      contentTypeId: documents.schemaId,
      fieldName: documentReferences.fieldName,
      toDocumentId: documentReferences.targetDocumentId,
    })
    .from(documentReferences)
    .innerJoin(documents, eq(documents.id, documentReferences.sourceDocumentId))
    .where(
      and(
        inArray(documentReferences.targetDocumentId, [...unpublishing]),
        isNotNull(documents.publishedHash),
        // Un référent qu'on dépublie dans le même geste ne pointera plus
        // depuis le publié : il ne s'oppose à rien.
        notInArray(documents.id, [...unpublishing]),
      ),
    );

  if (orphaning.length > 0) {
    throw new DocumentError(
      409,
      "referenced_by_published",
      `référencé depuis ${orphaning.length} document(s) publié(s)`,
      { references: orphaning },
    );
  }
}

/** Les documents nommés, ou un 404 qui dit lesquels manquent. */
async function loadAll(
  tx: Transaction,
  environmentId: string,
  documentIds: readonly string[],
) {
  const rows = await tx
    .select(columns)
    .from(documents)
    .where(
      and(
        eq(documents.environmentId, environmentId),
        inArray(documents.id, [...documentIds]),
      ),
    );

  if (rows.length !== documentIds.length) {
    const found = new Set(rows.map((row) => row.id));
    const missing = documentIds.filter((id) => !found.has(id));
    throw new DocumentError(
      404,
      "unknown_document",
      `introuvable : ${missing.join(", ")}`,
    );
  }
  return rows;
}

/**
 * Publier : `published_hash := current_hash`, pour **un ensemble**.
 *
 * ⚠️ **L'ensemble n'est pas une anticipation, c'est la forme du contrôle**
 * ([ADR 0021](../../../docs/adr/0021-ensemble-publie-clos-par-reference.md)).
 * L'invariant est *ce qui est publié ne pointe que vers du publié* ; deux
 * documents qui se référencent mutuellement ne peuvent être publiés que d'un
 * seul geste, en vérifiant la clôture sur le **résultat** plutôt que document
 * par document. Écrire ce service au singulier obligerait à le réécrire le
 * jour du premier cycle — et à réécrire la dépublication avec, puisque ni A ni
 * B ne pourrait alors être dépublié seul.
 *
 * ⚠️ **La seconde porte — la clôture — arrive avec les références** (jalon 5).
 * Aucune référence n'existe encore : la vérifier aujourd'hui serait un contrôle
 * sans rien à contrôler. Sa place est ici, entre la complétude et le
 * déplacement des pointeurs.
 */
export async function publishDocuments(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
  documentIds: readonly string[];
}) {
  const { actor, organizationId, environmentId, documentIds } = input;
  requirePermission(actor, CMS_PERMISSIONS.contentPublish);
  if (documentIds.length === 0) return [];

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const before = await loadAll(tx, environmentId, documentIds);
    await rejectIncomplete(tx, environmentId, before);
    await rejectUnclosedPublication(tx, documentIds);

    const published = [];
    for (const document of before) {
      if (document.publishedHash === document.currentHash) {
        published.push(document);
        continue;
      }

      const [updated] = await tx
        .update(documents)
        .set({ publishedHash: document.currentHash, updatedAt: new Date() })
        .where(eq(documents.id, document.id))
        .returning(columns);
      if (!updated) throw new DocumentError(404, "unknown_document", "introuvable");
      published.push(updated);

      // Ce que le public servait jusqu'ici peut n'être plus nommé par personne.
      if (document.publishedHash) {
        await forgetVersion(tx, organizationId, document.publishedHash);
      }
    }
    return published;
  });
}

/**
 * Dépublier : `published_hash := NULL`, pour un ensemble — l'autre porte du
 * même invariant.
 *
 * ⚠️ **Le refus de dépublier est la moitié qu'une formulation en règle aurait
 * manquée** (ADR 0021) : « ne pas publier contre un brouillon » ne dit rien de
 * la dépublication, et c'est pourtant le même trou par l'autre bout. Le
 * contrôle arrive avec les références, ici même.
 */
export async function unpublishDocuments(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
  documentIds: readonly string[];
}) {
  const { actor, organizationId, environmentId, documentIds } = input;
  requirePermission(actor, CMS_PERMISSIONS.contentPublish);
  if (documentIds.length === 0) return [];

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const before = await loadAll(tx, environmentId, documentIds);
    await rejectUnclosedUnpublication(tx, documentIds);

    const unpublished = [];
    for (const document of before) {
      if (!document.publishedHash) {
        unpublished.push(document);
        continue;
      }

      const [updated] = await tx
        .update(documents)
        .set({ publishedHash: null, updatedAt: new Date() })
        .where(eq(documents.id, document.id))
        .returning(columns);
      if (!updated) throw new DocumentError(404, "unknown_document", "introuvable");
      unpublished.push(updated);

      await forgetVersion(tx, organizationId, document.publishedHash);
    }
    return unpublished;
  });
}

/**
 * Abandonner les modifications : `current_hash := published_hash`.
 *
 * ⚠️ **Aucun contrôle de clôture ici**, et ce n'est pas un oubli : ce geste ne
 * change **rien à ce qui est publié**. L'ensemble publié est le même avant et
 * après, donc l'invariant ne peut pas être rompu.
 *
 * ⚠️ **Singulier, contrairement aux deux gestes ci-dessus** — et c'est le même
 * argument retourné : c'est parce qu'il ne touche pas l'ensemble publié qu'il
 * n'a aucun besoin d'en être un.
 */
export async function discardDraft(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
  documentId: string;
}) {
  const { actor, organizationId, environmentId, documentId } = input;
  requirePermission(actor, CMS_PERMISSIONS.contentWrite);

  return withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [before] = await tx
      .select(columns)
      .from(documents)
      .where(
        and(eq(documents.id, documentId), eq(documents.environmentId, environmentId)),
      );
    if (!before) throw new DocumentError(404, "unknown_document", "introuvable");

    if (!before.publishedHash) {
      // Rien n'a jamais été publié : il n'y a pas d'état où revenir. Un 409
      // plutôt qu'un no-op, parce que l'écran n'aurait pas dû l'offrir.
      throw new DocumentError(409, "nothing_published", "aucun état publié où revenir");
    }
    if (before.publishedHash === before.currentHash) return before;

    const [version] = await tx
      .select({ data: documentVersions.data })
      .from(documentVersions)
      .where(eq(documentVersions.hash, before.publishedHash));
    if (!version) throw new Error("published version missing from the store");

    const [restored] = await tx
      .update(documents)
      .set({
        data: version.data,
        currentHash: before.publishedHash,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId))
      .returning(columns);
    if (!restored) throw new DocumentError(404, "unknown_document", "introuvable");

    await forgetVersion(tx, organizationId, before.currentHash);
    return restored;
  });
}
