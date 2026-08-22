import assert from "node:assert/strict";
import "../test-support/bootstrap.ts";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { app } from "../app.ts";
import { resolveActor } from "../auth/authorization.ts";
import { closePool, withContext } from "../db/client.ts";
import { masterEnvironment } from "../services/api-keys.ts";
import { destroyOrganization, destroyUsers } from "../test-support/cleanup.ts";
import { createVerifiedUser } from "../test-support/users.ts";
import { fingerprint } from "./fingerprint.ts";
import { schemaHistory, schemas, schemaVersions } from "./schema.ts";
import {
  createSchema,
  listSchemaHistory,
  restoreSchemaVersion,
  updateSchema,
} from "./schemas.ts";

/**
 * Le versionnage des schémas (ADR 0016), éprouvé contre la vraie base.
 *
 * ⚠️ **Aucune route n'expose encore l'historique ni la restauration** — elles
 * viendront avec l'écran. Les tests appellent donc les services directement,
 * mais toujours à travers `withContext` et RLS : ce qui est éprouvé ici, c'est
 * le modèle et la transaction, pas la couche HTTP.
 */

const field = (name: string, type = "text" as const, required = true) => ({
  name,
  type,
  validation: { required },
});

const definition = (...names: string[]) => ({ fields: names.map((n) => field(n)) });

describe("versionnage des schémas", () => {
  let userId = "";
  let organizationId = "";
  let environmentId = "";
  let actor: Awaited<ReturnType<typeof resolveActor>>;

  const call = (path: string, cookie: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { "Content-Type": "application/json", cookie },
    });

  before(async () => {
    const user = await createVerifiedUser("version-owner");
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

    // Le service parle d'environnements, l'API n'en parle jamais : `master` se
    // résout ici exactement comme la route le fait.
    environmentId = await masterEnvironment(userId, organizationId, projectId);

    actor = await resolveActor(userId, organizationId);
  });

  after(async () => {
    await destroyOrganization(userId, organizationId);
    await destroyUsers([userId]);
    await closePool();
  });

  const historyOf = async (schemaId: string) =>
    (await listSchemaHistory({ actor, organizationId, environmentId, schemaId }))
      .entries;

  /**
   * ⚠️ Deux mécanismes que la documentation Postgres promet mais que rien ici
   * n'avait éprouvé : une colonne d'identité écrite par un rôle non
   * propriétaire, et un `INSERT` sur une table dont la seule policy d'écriture
   * est `FOR INSERT`.
   */
  it("crée un schéma avec sa version et sa première ligne de journal", async () => {
    const fields = {
      name: "article",
      label: "Article",
      definition: definition("title"),
    };
    const created = await createSchema({
      actor,
      organizationId,
      environmentId,
      fields,
    });

    const journal = await historyOf(created.id);
    assert.equal(journal.length, 1);
    assert.equal(journal[0]?.action, "saved");
    assert.equal(journal[0]?.hash, fingerprint(fields), "l'empreinte du contenu");
    assert.match(journal[0]?.actorEmail ?? "", /^version-owner-/);

    const [stored] = await withContext({ userId, organizationId }, (tx) =>
      tx
        .select({ currentHash: schemas.currentHash })
        .from(schemas)
        .where(eq(schemas.id, created.id)),
    );
    assert.equal(stored?.currentHash, fingerprint(fields));
  });

  it("n'écrit rien quand la définition enregistrée est celle qui est déjà là", async () => {
    const fields = { name: "noop", label: null, definition: definition("title") };
    const created = await createSchema({
      actor,
      organizationId,
      environmentId,
      fields,
    });

    const again = await updateSchema({
      actor,
      organizationId,
      environmentId,
      schemaId: created.id,
      fields,
    });

    // ⚠️ No-op complet : `updated_at` ne bouge pas non plus. Le journal
    // enregistre les changements d'état, pas les gestes de sauvegarde.
    assert.deepEqual(again, created);
    assert.equal((await historyOf(created.id)).length, 1);
  });

  it("ajoute une version et une ligne quand la définition change", async () => {
    const created = await createSchema({
      actor,
      organizationId,
      environmentId,
      fields: { name: "evolving", label: null, definition: definition("title") },
    });

    await updateSchema({
      actor,
      organizationId,
      environmentId,
      schemaId: created.id,
      fields: {
        name: "evolving",
        label: null,
        definition: definition("title", "body"),
      },
    });

    const journal = await historyOf(created.id);
    assert.equal(journal.length, 2);
    // Du plus récent au plus ancien : `seq` ordonne, et n'est pas renvoyée.
    assert.deepEqual(
      journal.map((entry) => entry.action),
      ["saved", "saved"],
    );
    assert.notEqual(journal[0]?.hash, journal[1]?.hash);
  });

  /**
   * ⚠️ Le libellé est dans l'empreinte, et c'est ce test qui le prouve de bout
   * en bout : renommer un libellé **est** une version, sinon une copie de
   * bibliothèque localisée se lirait « identique ».
   */
  it("versionne un changement de libellé seul", async () => {
    const created = await createSchema({
      actor,
      organizationId,
      environmentId,
      fields: { name: "labelled", label: "Author", definition: definition("title") },
    });

    await updateSchema({
      actor,
      organizationId,
      environmentId,
      schemaId: created.id,
      fields: { name: "labelled", label: "Auteur", definition: definition("title") },
    });

    assert.equal((await historyOf(created.id)).length, 2);
  });

  describe("restauration", () => {
    let schemaId = "";
    let first = "";

    before(async () => {
      const fields = {
        name: "restorable",
        label: "Avant",
        definition: definition("title"),
      };
      const created = await createSchema({
        actor,
        organizationId,
        environmentId,
        fields,
      });
      schemaId = created.id;
      first = fingerprint(fields);

      await updateSchema({
        actor,
        organizationId,
        environmentId,
        schemaId,
        fields: {
          name: "restorable",
          label: "Après",
          definition: definition("title", "body"),
        },
      });
    });

    /**
     * ⚠️ **La ligne enregistre le hachage vers lequel on restaure** — elle dit
     * « l'état est redevenu X ». C'est ce qui laisse l'aller-retour visible :
     * le journal n'est jamais réécrit.
     */
    it("remet l'état exact, et l'écrit comme `restored`", async () => {
      const restored = await restoreSchemaVersion({
        actor,
        organizationId,
        environmentId,
        schemaId,
        hash: first,
      });

      assert.equal(restored.label, "Avant");
      assert.deepEqual(restored.definition, definition("title"));

      const journal = await historyOf(schemaId);
      assert.equal(journal.length, 3);
      assert.equal(journal[0]?.action, "restored");
      assert.equal(journal[0]?.hash, first, "le hachage vers lequel on restaure");
      assert.deepEqual(
        journal.map((entry) => entry.action),
        ["restored", "saved", "saved"],
        "A → B → A reste lisible : rien n'est réécrit",
      );
    });

    it("ne crée pas de seconde version pour un état déjà connu", async () => {
      const versions = await withContext({ userId, organizationId }, (tx) =>
        tx
          .select({ hash: schemaVersions.hash })
          .from(schemaVersions)
          .where(eq(schemaVersions.hash, first)),
      );
      assert.equal(versions.length, 1, "la version est un contenu, pas un événement");
    });

    it("ne fait rien de plus si l'état demandé est déjà le courant", async () => {
      const before = (await historyOf(schemaId)).length;
      await restoreSchemaVersion({
        actor,
        organizationId,
        environmentId,
        schemaId,
        hash: first,
      });
      assert.equal((await historyOf(schemaId)).length, before);
    });

    /**
     * ⚠️ Les versions sont dédupliquées **par organization** : une empreinte
     * peut exister sans avoir jamais appartenu à ce schéma-ci. Y aller ne
     * serait pas une restauration mais une affectation.
     */
    it("refuse une version que ce schéma n'a jamais eue", async () => {
      const other = await createSchema({
        actor,
        organizationId,
        environmentId,
        fields: { name: "stranger", label: null, definition: definition("other") },
      });
      const strangerHash = fingerprint({
        name: "stranger",
        label: null,
        definition: definition("other"),
      });

      await assert.rejects(
        restoreSchemaVersion({
          actor,
          organizationId,
          environmentId,
          schemaId,
          hash: strangerHash,
        }),
        (error: Error & { reason?: string }) => error.reason === "unknown_version",
      );
      assert.ok(other.id, "le schéma voisin existe bel et bien");
    });

    /**
     * ⚠️ Le nom fait partie de la version. Le remettre peut heurter un schéma
     * créé entre-temps sous cet ancien nom — un 409 nommé, pas une violation
     * de contrainte en 500.
     */
    it("refuse une restauration dont le nom est déjà pris", async () => {
      const renamed = await createSchema({
        actor,
        organizationId,
        environmentId,
        fields: { name: "avant", label: null, definition: definition("title") },
      });
      const taken = fingerprint({
        name: "avant",
        label: null,
        definition: definition("title"),
      });

      await updateSchema({
        actor,
        organizationId,
        environmentId,
        schemaId: renamed.id,
        fields: { name: "apres", label: null, definition: definition("title") },
      });

      // Quelqu'un reprend le nom libéré.
      await createSchema({
        actor,
        organizationId,
        environmentId,
        fields: { name: "avant", label: null, definition: definition("autre") },
      });

      await assert.rejects(
        restoreSchemaVersion({
          actor,
          organizationId,
          environmentId,
          schemaId: renamed.id,
          hash: taken,
        }),
        (error: Error & { reason?: string }) => error.reason === "duplicate_name",
      );
    });
  });

  /**
   * ⚠️ **Le journal part avec le schéma, les versions restent.** Elles sont du
   * contenu partagé par organization : un autre schéma peut pointer sur la même
   * ligne. C'est ce que Git fait de ses blobs.
   *
   * Ce test éprouve aussi que la cascade traverse une table dont **aucune
   * policy `DELETE` n'existe** — Postgres promet que l'intégrité référentielle
   * contourne RLS, et c'est ici qu'on le vérifie plutôt que de le supposer.
   */
  it("emporte le journal avec le schéma, et laisse les versions", async () => {
    const fields = { name: "ephemere", label: null, definition: definition("title") };
    const created = await createSchema({
      actor,
      organizationId,
      environmentId,
      fields,
    });
    const hash = fingerprint(fields);

    await withContext({ userId, organizationId }, (tx) =>
      tx.delete(schemas).where(eq(schemas.id, created.id)),
    );

    const [remaining, orphaned] = await withContext(
      { userId, organizationId },
      async (tx) => [
        await tx
          .select({ hash: schemaVersions.hash })
          .from(schemaVersions)
          .where(eq(schemaVersions.hash, hash)),
        await tx
          .select({ hash: schemaHistory.hash })
          .from(schemaHistory)
          .where(
            and(
              eq(schemaHistory.schemaId, created.id),
              eq(schemaHistory.organizationId, organizationId),
            ),
          ),
      ],
    );

    assert.equal(remaining.length, 1, "la version survit à son schéma");
    assert.equal(orphaned.length, 0, "le journal part avec lui");
  });
});
