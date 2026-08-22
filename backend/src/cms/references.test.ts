import assert from "node:assert/strict";
import "../test-support/bootstrap.ts";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { app } from "../app.ts";
import { resolveActor } from "../auth/authorization.ts";
import { closePool, withContext } from "../db/client.ts";
import { masterEnvironment } from "../services/api-keys.ts";
import { destroyOrganization, destroyUsers } from "../test-support/cleanup.ts";
import { createVerifiedUser } from "../test-support/users.ts";
import {
  createDocument,
  deleteDocument,
  publishDocuments,
  rebuildReferenceIndex,
  unpublishDocuments,
  updateDocument,
} from "./documents.ts";
import { documentReferences } from "./schema.ts";
import { createSchema, updateSchema } from "./schemas.ts";

/**
 * Les références entre documents (ADR 0020) et l'invariant de clôture
 * (ADR 0021), contre la vraie base.
 *
 * ⚠️ **La clôture cesse ici d'être vraie par vacuité.** Jusqu'à ce jalon,
 * aucune référence n'existait et les deux portes de la publication ne
 * refusaient jamais rien.
 */

describe("références entre documents", () => {
  let userId = "";
  let organizationId = "";
  let environmentId = "";
  let actor: Awaited<ReturnType<typeof resolveActor>>;
  let authorType = "";
  let articleType = "";
  let schemaBase = "";
  let cookie = "";

  const call = (path: string, cookie: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { "Content-Type": "application/json", cookie },
    });

  const text = (name: string, required = false) => ({
    name,
    type: "text" as const,
    validation: { required },
  });
  const ref = (name: string, to: string) => ({
    name,
    type: "reference" as const,
    to,
    validation: { required: false },
  });

  const write = (schemaId: string, data: Record<string, unknown>) =>
    createDocument({ actor, organizationId, environmentId, schemaId, data });

  const indexOf = (sourceDocumentId: string) =>
    withContext({ userId, organizationId }, (tx) =>
      tx
        .select({
          field: documentReferences.fieldName,
          target: documentReferences.targetDocumentId,
        })
        .from(documentReferences)
        .where(eq(documentReferences.sourceDocumentId, sourceDocumentId)),
    );

  before(async () => {
    const user = await createVerifiedUser("reference-owner");
    userId = user.id;
    cookie = user.cookie;

    const organization = await call("/api/organizations", user.cookie, {
      method: "POST",
      body: JSON.stringify({ name: "Acme" }),
    });
    organizationId = ((await organization.json()) as { id: string }).id;

    const project = await call(
      `/api/organizations/${organizationId}/projects`,
      user.cookie,
      { method: "POST", body: JSON.stringify({ name: "Site" }) },
    );
    const { id: projectId } = (await project.json()) as { id: string };
    environmentId = await masterEnvironment(userId, organizationId, projectId);
    schemaBase = `/api/organizations/${organizationId}/projects/${projectId}/schemas`;
    actor = await resolveActor(userId, organizationId);

    const author = await createSchema({
      actor,
      organizationId,
      environmentId,
      fields: {
        name: "author",
        label: "Author",
        definition: { fields: [text("fullName", true)] },
      },
    });
    authorType = author.id;

    const article = await createSchema({
      actor,
      organizationId,
      environmentId,
      fields: {
        name: "article",
        label: "Article",
        definition: { fields: [text("title", true), ref("author", "author")] },
      },
    });
    articleType = article.id;
  });

  after(async () => {
    await destroyOrganization(userId, organizationId);
    await destroyUsers([userId]);
    await closePool();
  });

  describe("le sixième type de champ", () => {
    it("refuse un `to` qui ne nomme aucun type de cet environnement", async () => {
      await assert.rejects(
        createSchema({
          actor,
          organizationId,
          environmentId,
          fields: {
            name: "orphan",
            label: null,
            definition: { fields: [ref("ghost", "fantome")] },
          },
        }),
        (error: Error & { reason?: string; message: string }) =>
          error.reason === "unknown_reference_target" &&
          error.message.includes("fantome"),
      );
    });

    /**
     * ⚠️ **Un type peut se viser lui-même** — un article qui pointe un article
     * connexe. Il n'existe pas encore au moment de sa création, donc c'est le
     * nom qu'on s'apprête à écrire qui compte.
     */
    it("laisse un type se viser lui-même dès sa création", async () => {
      const related = await createSchema({
        actor,
        organizationId,
        environmentId,
        fields: {
          name: "chapter",
          label: null,
          definition: { fields: [text("title"), ref("next", "chapter")] },
        },
      });
      assert.ok(related.id);
    });

    /**
     * ⚠️ **`to` et `reference` vont ensemble ou pas du tout.** Sans ce refus,
     * un champ `text` porterait un `to` que personne ne lit — deux écritures
     * pour un même sens, donc **deux empreintes pour un même schéma**.
     *
     * Le refus vit dans le schéma Zod, donc à la frontière : c'est par la
     * route qu'il se prouve, en 400.
     */
    it("refuse un `to` sur un champ qui n'est pas une référence", async () => {
      const body = (field: Record<string, unknown>) =>
        JSON.stringify({
          name: "malforme",
          label: null,
          definition: { fields: [field] },
        });

      const withStrayTo = await call(schemaBase, cookie, {
        method: "POST",
        body: body({
          name: "title",
          type: "text",
          to: "author",
          validation: { required: false },
        }),
      });
      assert.equal(withStrayTo.status, 400, "un `to` égaré est refusé");

      const withoutTo = await call(schemaBase, cookie, {
        method: "POST",
        body: body({
          name: "author",
          type: "reference",
          validation: { required: false },
        }),
      });
      assert.equal(withoutTo.status, 400, "une référence sans cible aussi");
    });
  });

  describe("l'index dérivé", () => {
    it("naît et se réécrit avec le document", async () => {
      const hugo = await write(authorType, { fullName: "Hugo" });
      const zola = await write(authorType, { fullName: "Zola" });

      const article = await write(articleType, {
        title: "Les Misérables",
        author: hugo.id,
      });
      assert.deepEqual(await indexOf(article.id), [
        { field: "author", target: hugo.id },
      ]);

      await updateDocument({
        actor,
        organizationId,
        environmentId,
        documentId: article.id,
        data: { title: "Les Misérables", author: zola.id },
      });
      assert.deepEqual(
        await indexOf(article.id),
        [{ field: "author", target: zola.id }],
        "réécrit, jamais accumulé",
      );

      await updateDocument({
        actor,
        organizationId,
        environmentId,
        documentId: article.id,
        data: { title: "Les Misérables" },
      });
      assert.deepEqual(await indexOf(article.id), [], "la référence retirée disparaît");
    });

    /**
     * ⚠️ **La clé composite garantit l'existence et l'environnement, jamais le
     * type.** C'est le seul des trois contrôles qui soit applicatif — et ADR
     * 0020 ne le dit pas.
     */
    it("refuse une cible du mauvais type de contenu", async () => {
      const hugo = await write(authorType, { fullName: "Hugo" });
      const other = await write(articleType, { title: "Un autre", author: hugo.id });

      await assert.rejects(
        write(articleType, { title: "Mal visé", author: other.id }),
        (error: Error & { reason?: string; message: string }) =>
          error.reason === "wrong_reference_type" && error.message.includes("author"),
      );
    });

    it("refuse une cible qui n'existe pas", async () => {
      await assert.rejects(
        write(articleType, {
          title: "Vers le vide",
          author: "00000000-0000-4000-8000-000000000000",
        }),
        (error: Error & { reason?: string }) => error.reason === "unknown_reference",
      );
    });

    /**
     * ⚠️ **`RESTRICT` sans ses manières serait un 409 nu.** Le refus nomme ce
     * qui pointe — c'est la seule raison d'être de l'index.
     */
    it("refuse de supprimer une cible référencée, en nommant les référents", async () => {
      const hugo = await write(authorType, { fullName: "Hugo" });
      const article = await write(articleType, { title: "Signé", author: hugo.id });

      await assert.rejects(
        deleteDocument({
          actor,
          organizationId,
          environmentId,
          documentId: hugo.id,
        }),
        (error: Error & { status?: number; reason?: string; message: string }) =>
          error.status === 409 &&
          error.reason === "referenced" &&
          error.message.includes(article.id),
      );
    });

    /**
     * ⚠️ **Ce qui rend « dette réparable » réel plutôt que théorique** : `data`
     * fait foi, donc un index abîmé se reconstruit sans qu'aucune donnée ne
     * soit perdue.
     */
    it("se reconstruit depuis les documents", async () => {
      const hugo = await write(authorType, { fullName: "Hugo" });
      const article = await write(articleType, { title: "À rebâtir", author: hugo.id });

      // On abîme délibérément l'index — ce qu'un défaut ferait.
      await withContext({ userId, organizationId }, (tx) =>
        tx
          .delete(documentReferences)
          .where(eq(documentReferences.sourceDocumentId, article.id)),
      );
      assert.deepEqual(await indexOf(article.id), []);

      const rebuilt = await rebuildReferenceIndex({
        actor,
        organizationId,
        environmentId,
      });
      assert.ok(rebuilt.documents > 0);
      assert.deepEqual(await indexOf(article.id), [
        { field: "author", target: hugo.id },
      ]);
    });
  });

  describe("la clôture du publié", () => {
    it("refuse de publier ce qui pointe vers un brouillon", async () => {
      const hugo = await write(authorType, { fullName: "Hugo" });
      const article = await write(articleType, { title: "Prématuré", author: hugo.id });

      await assert.rejects(
        publishDocuments({
          actor,
          organizationId,
          environmentId,
          documentIds: [article.id],
        }),
        (error: Error & { status?: number; reason?: string; message: string }) =>
          error.status === 409 &&
          error.reason === "references_unpublished" &&
          error.message.includes(hugo.id),
      );
    });

    it("laisse publier quand la cible est déjà publiée", async () => {
      const hugo = await write(authorType, { fullName: "Hugo" });
      const article = await write(articleType, { title: "À l'heure", author: hugo.id });

      await publishDocuments({
        actor,
        organizationId,
        environmentId,
        documentIds: [hugo.id],
      });
      const published = await publishDocuments({
        actor,
        organizationId,
        environmentId,
        documentIds: [article.id],
      });
      assert.equal(published.length, 1);
    });

    /**
     * ⚠️ **La publication groupée est la seule issue aux cycles**, et c'est ce
     * test qui le prouve : ni A ni B ne peut être publié seul, les deux
     * ensemble passent. C'est pour ça que le contrôle porte sur une transition
     * d'ensemble depuis le premier jour.
     */
    it("ne publie un cycle que d'un seul geste", async () => {
      // `author` gagne un champ vers `article` — le troisième geste que la
      // modélisation mutuelle demande.
      await updateSchema({
        actor,
        organizationId,
        environmentId,
        schemaId: authorType,
        fields: {
          name: "author",
          label: "Author",
          definition: { fields: [text("fullName", true), ref("latest", "article")] },
        },
      });

      const hugo = await write(authorType, { fullName: "Cyclique" });
      const article = await write(articleType, { title: "Cyclique", author: hugo.id });
      await updateDocument({
        actor,
        organizationId,
        environmentId,
        documentId: hugo.id,
        data: { fullName: "Cyclique", latest: article.id },
      });

      const publish = (documentIds: readonly string[]) =>
        publishDocuments({ actor, organizationId, environmentId, documentIds });

      await assert.rejects(publish([hugo.id]), "A seul pointe vers un brouillon");
      await assert.rejects(publish([article.id]), "B seul aussi");

      const both = await publish([hugo.id, article.id]);
      assert.equal(
        both.length,
        2,
        "ensemble, la clôture est satisfaite sur le résultat",
      );
    });

    /**
     * ⚠️ **L'autre porte, celle qu'une formulation en règle aurait manquée.**
     * « Ne pas publier contre un brouillon » ne dit rien de la dépublication —
     * et c'est pourtant le même trou par l'autre bout.
     */
    it("refuse de dépublier ce qu'un document publié référence", async () => {
      const hugo = await write(authorType, { fullName: "Retiré" });
      const article = await write(articleType, { title: "Le tient", author: hugo.id });
      await publishDocuments({
        actor,
        organizationId,
        environmentId,
        documentIds: [hugo.id, article.id],
      });

      await assert.rejects(
        unpublishDocuments({
          actor,
          organizationId,
          environmentId,
          documentIds: [hugo.id],
        }),
        (error: Error & { status?: number; reason?: string; message: string }) =>
          error.status === 409 &&
          error.reason === "referenced_by_published" &&
          error.message.includes(article.id),
      );

      const both = await unpublishDocuments({
        actor,
        organizationId,
        environmentId,
        documentIds: [hugo.id, article.id],
      });
      assert.equal(both.length, 2, "ensemble, plus rien de publié ne pointe vers eux");
    });
  });
});
