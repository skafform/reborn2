import assert from "node:assert/strict";
import "../test-support/bootstrap.ts";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { app } from "../app.ts";
import { resolveActor } from "../auth/authorization.ts";
import { closePool, unsafePoolForIntrospection, withContext } from "../db/client.ts";
import { masterEnvironment } from "../services/api-keys.ts";
import { destroyOrganization, destroyUsers } from "../test-support/cleanup.ts";
import { createVerifiedUser } from "../test-support/users.ts";
import {
  createDocument,
  deleteDocument,
  listDocuments,
  updateDocument,
} from "./documents.ts";
import { documentFingerprint } from "./fingerprint.ts";
import { documentVersions } from "./schema.ts";
import { deleteSchema } from "./schemas.ts";

/**
 * Les documents (ADR 0022), contre la vraie base.
 *
 * ⚠️ **Aucune route ne les expose encore** — le jalon 6 les révélera. Ce qui
 * est éprouvé ici est le modèle, la transaction, et surtout le **nettoyage
 * synchrone** : sans lui, le magasin croîtrait sans borne dès le premier jour.
 */

describe("documents", () => {
  let userId = "";
  let organizationId = "";
  let environmentId = "";
  let schemaId = "";
  let actor: Awaited<ReturnType<typeof resolveActor>>;

  const call = (path: string, cookie: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { "Content-Type": "application/json", cookie },
    });

  /** Les versions de cette organization qui portent cette empreinte. */
  const versionsOf = (hash: string) =>
    withContext({ userId, organizationId }, (tx) =>
      tx
        .select({ hash: documentVersions.hash })
        .from(documentVersions)
        .where(eq(documentVersions.hash, hash)),
    );

  const write = (data: Record<string, unknown>) =>
    createDocument({ actor, organizationId, environmentId, schemaId, data });

  before(async () => {
    const user = await createVerifiedUser("document-owner");
    userId = user.id;

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

    const schema = await call(
      `/api/organizations/${organizationId}/projects/${projectId}/schemas`,
      user.cookie,
      {
        method: "POST",
        body: JSON.stringify({
          name: "article",
          label: "Article",
          definition: {
            fields: [
              { name: "title", type: "text", validation: { required: true } },
              { name: "words", type: "number", validation: { required: false } },
            ],
          },
        }),
      },
    );
    schemaId = ((await schema.json()) as { id: string }).id;

    actor = await resolveActor(userId, organizationId);
  });

  after(async () => {
    await destroyOrganization(userId, organizationId);
    await destroyUsers([userId]);
    await closePool();
  });

  it("crée un document, sa version, et le rend en brouillon", async () => {
    const data = { title: "Hello" };
    const created = await write(data);

    assert.equal(created.currentHash, documentFingerprint(data));
    assert.equal(created.publishedHash, null, "rien n'est publié : c'est un brouillon");
    assert.deepEqual(created.data, data, "`data` est dénormalisé sur la ligne");
    assert.equal((await versionsOf(created.currentHash)).length, 1);
  });

  /**
   * ⚠️ **L'invariant silencieux d'ADR 0022** : `data` sur la ligne **est** la
   * version que `current_hash` nomme. Une seule fonction d'écriture les pose
   * ensemble ; ce test est ce qui l'assure, parce que c'est le genre de
   * dédoublement qui dérive si deux chemins d'écriture apparaissent un jour.
   */
  it("garde `data` et la version pointée identiques", async () => {
    const created = await write({ title: "Aligné", words: 3 });
    const updated = await updateDocument({
      actor,
      organizationId,
      environmentId,
      documentId: created.id,
      data: { title: "Aligné autrement", words: 4 },
    });

    const [version] = await withContext({ userId, organizationId }, (tx) =>
      tx
        .select({ data: documentVersions.data })
        .from(documentVersions)
        .where(eq(documentVersions.hash, updated.currentHash)),
    );
    assert.deepEqual(version?.data, updated.data);
    assert.equal(documentFingerprint(updated.data), updated.currentHash);
  });

  it("refuse une donnée non conforme au type de contenu, en nommant le champ", async () => {
    await assert.rejects(
      write({ title: 42 }),
      (error: Error & { status?: number; message: string }) =>
        error.status === 422 && error.message.includes("title"),
    );
  });

  it("refuse une clé hors définition", async () => {
    await assert.rejects(
      write({ title: "ok", titel: "typo" }),
      (error: Error & { status?: number }) => error.status === 422,
    );
  });

  it("accepte un brouillon dont le champ requis manque", async () => {
    // ⚠️ La complétude appartient à la publication (ADR 0017 raffiné) : un
    // brouillon au champ requis vide est l'état normal du travail éditorial.
    const created = await write({ words: 7 });
    assert.deepEqual(created.data, { words: 7 });
  });

  it("n'écrit rien quand la donnée enregistrée est celle qui est déjà là", async () => {
    const created = await write({ title: "Inchangé" });
    const again = await updateDocument({
      actor,
      organizationId,
      environmentId,
      documentId: created.id,
      data: { title: "Inchangé" },
    });
    assert.deepEqual(again, created, "no-op complet, `updated_at` compris");
  });

  describe("le nettoyage synchrone", () => {
    /**
     * ⚠️ **Le cœur du jalon.** Chaque enregistrement rend une version
     * orpheline ; sans ce nettoyage, un document édité cinquante fois laisse
     * quarante-huit lignes que rien ne pourra plus jamais atteindre.
     */
    it("oublie la version qu'un enregistrement vient de rendre inatteignable", async () => {
      const created = await write({ title: "Avant" });
      const orphaned = created.currentHash;

      const updated = await updateDocument({
        actor,
        organizationId,
        environmentId,
        documentId: created.id,
        data: { title: "Après" },
      });

      assert.equal((await versionsOf(orphaned)).length, 0, "l'ancienne est oubliée");
      assert.equal((await versionsOf(updated.currentHash)).length, 1, "la neuve reste");
    });

    /**
     * ⚠️ **La déduplication n'est pas un détail de stockage, c'est ce qui rend
     * le nettoyage correct.** Deux documents au contenu identique partagent
     * une ligne : l'oublier parce que l'un s'en détache effacerait le contenu
     * de l'autre.
     */
    it("garde une version qu'un autre document nomme encore", async () => {
      const shared = { title: "Partagé" };
      const first = await write(shared);
      const second = await write(shared);
      assert.equal(first.currentHash, second.currentHash, "même contenu, même ligne");

      await updateDocument({
        actor,
        organizationId,
        environmentId,
        documentId: first.id,
        data: { title: "Plus partagé" },
      });

      assert.equal(
        (await versionsOf(second.currentHash)).length,
        1,
        "le second document la nomme encore",
      );
    });

    it("oublie les versions d'un document supprimé", async () => {
      const created = await write({ title: "Éphémère" });
      await deleteDocument({
        actor,
        organizationId,
        environmentId,
        documentId: created.id,
      });
      assert.equal((await versionsOf(created.currentHash)).length, 0);
    });
  });

  /**
   * ⚠️ **La course perdue, jouée pour de vrai.**
   *
   * Deux transactions, un ordre imposé : la seconde reprend l'empreinte que la
   * première s'apprête à oublier. Le `NOT EXISTS` de la première ne voit rien
   * — l'insertion de l'autre n'est pas encore validée — donc la suppression
   * part, se bloque sur le verrou de la clé étrangère, et **échoue** quand
   * l'autre valide.
   *
   * Ce que ce test prouve : ce refus est avalé, et la transaction extérieure
   * **survit**. Sans le `SAVEPOINT`, elle serait morte, emportant
   * l'enregistrement qu'on venait de faire.
   *
   * Il passe par des clients bruts parce qu'il faut deux transactions
   * simultanées, ce que `withContext` ne permet pas — et il pose donc le
   * contexte RLS à la main, exactement comme `withContext` le ferait.
   */
  it("survit à une course perdue contre la clé étrangère", async () => {
    const pool = unsafePoolForIntrospection();
    const looser = await pool.connect();
    const taker = await pool.connect();

    const context = async (client: typeof looser) => {
      await client.query("begin");
      await client.query("select set_config('app.current_user_id', $1, true)", [
        userId,
      ]);
      await client.query("select set_config('app.current_organization_id', $1, true)", [
        organizationId,
      ]);
    };

    try {
      const contested = await write({ title: "Contesté" });
      const hash = contested.currentHash;

      // Le repreneur insère un second document sur la même empreinte, et **ne
      // valide pas** : sa ligne pose un verrou sur la version sans être visible.
      await context(taker);
      await taker.query(
        `insert into documents (environment_id, organization_id, schema_id, data, current_hash)
         values ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5)`,
        [
          environmentId,
          organizationId,
          schemaId,
          JSON.stringify({ title: "Contesté" }),
          hash,
        ],
      );

      // Le perdant libère l'empreinte : la version de remplacement d'abord —
      // le pointeur porte une clé étrangère vers elle — puis le déplacement.
      const freed = { title: "Libéré" };
      const freedHash = documentFingerprint(freed);
      await context(looser);
      await looser.query(
        `insert into document_versions (organization_id, hash, data)
         values ($1::uuid, $2, $3::jsonb) on conflict do nothing`,
        [organizationId, freedHash, JSON.stringify(freed)],
      );
      await looser.query(
        "update documents set current_hash = $1, data = $2::jsonb where id = $3::uuid",
        [freedHash, JSON.stringify(freed), contested.id],
      );

      await looser.query("savepoint forget");
      const blocked = looser.query(
        `delete from document_versions v
          where v.organization_id = $1::uuid and v.hash = $2
            and not exists (select 1 from documents d
                             where d.organization_id = v.organization_id
                               and (d.current_hash = v.hash or d.published_hash = v.hash))`,
        [organizationId, hash],
      );

      // Le repreneur valide : le perdant se débloque et heurte la clé.
      await taker.query("commit");

      let refused: unknown;
      await blocked.catch((error) => {
        refused = error;
      });

      assert.ok(refused, "la suppression doit être refusée");
      assert.equal(
        (refused as { code?: string }).code,
        "23503",
        "et par la clé étrangère, pas autrement",
      );

      // Ce que le service fait de ce refus : il l'avale, et poursuit.
      await looser.query("rollback to savepoint forget");
      const survivor = await looser.query("select 1 as alive");
      assert.equal(survivor.rows[0]?.alive, 1, "la transaction extérieure survit");
      await looser.query("commit");

      const kept = await versionsOf(hash);
      assert.equal(kept.length, 1, "la version référencée vit — le système fonctionne");
    } finally {
      await looser.query("rollback").catch(() => {});
      await taker.query("rollback").catch(() => {});
      looser.release();
      taker.release();
    }
  });

  it("liste les documents d'un type", async () => {
    const listed = await listDocuments({
      actor,
      organizationId,
      environmentId,
      schemaId,
    });
    assert.ok(listed.length > 0);
    assert.ok(listed.every((entry) => entry.schemaId === schemaId));
  });

  /**
   * ⚠️ **Le refus compte ce qui reste**, comme partout ici — révoquer une clé
   * avant de la supprimer, vider une organization avant de l'effacer.
   * `documents_schema_fk` est en `RESTRICT` : sans ce contrôle applicatif, le
   * refus remonterait en 500 au lieu de dire ce qui bloque.
   */
  it("refuse de supprimer un type de contenu qui porte des documents", async () => {
    await assert.rejects(
      deleteSchema({ actor, organizationId, environmentId, schemaId }),
      (error: Error & { status?: number; reason?: string; message: string }) =>
        error.status === 409 &&
        error.reason === "schema_in_use" &&
        /\d+ document/.test(error.message),
    );
  });

  /**
   * ⚠️ **Deux cascades partent du même environnement** — vers les types et
   * vers les documents — et une clé `RESTRICT` les relie. Ce test épingle que
   * supprimer un projet fonctionne quand même : sans lui, la découverte se
   * ferait au nettoyage d'une suite de tests, c'est-à-dire tard et de travers.
   */
  it("laisse supprimer un projet qui porte des documents", async () => {
    const user = await createVerifiedUser("document-cascade");
    const organization = await call("/api/organizations", user.cookie, {
      method: "POST",
      body: JSON.stringify({ name: "Cascade" }),
    });
    const scoped = ((await organization.json()) as { id: string }).id;

    try {
      const project = await call(`/api/organizations/${scoped}/projects`, user.cookie, {
        method: "POST",
        body: JSON.stringify({ name: "Jetable" }),
      });
      const { id: projectId } = (await project.json()) as { id: string };
      const base = `/api/organizations/${scoped}/projects/${projectId}/schemas`;

      const schema = await call(base, user.cookie, {
        method: "POST",
        body: JSON.stringify({
          name: "note",
          label: null,
          definition: {
            fields: [{ name: "title", type: "text", validation: { required: true } }],
          },
        }),
      });
      const created = ((await schema.json()) as { id: string }).id;

      const scopedActor = await resolveActor(user.id, scoped);
      const environment = await masterEnvironment(user.id, scoped, projectId);
      await createDocument({
        actor: scopedActor,
        organizationId: scoped,
        environmentId: environment,
        schemaId: created,
        data: { title: "Emportée" },
      });

      // `destroyOrganization` supprime les projets d'abord : c'est le geste
      // qui déclenche les deux cascades en même temps.
      await destroyOrganization(user.id, scoped);
    } finally {
      await destroyUsers([user.id]);
    }
  });
});
