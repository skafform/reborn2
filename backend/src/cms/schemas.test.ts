import assert from "node:assert/strict";
import "../test-support/bootstrap.ts";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { app } from "../app.ts";
import { closePool, withContext } from "../db/client.ts";
import { organizationMembers, roles } from "../db/schema.ts";
import { destroyOrganization, destroyUsers } from "../test-support/cleanup.ts";
import { createVerifiedUser } from "../test-support/users.ts";

/**
 * Les types de contenu, éprouvés par la chaîne complète : session, middleware,
 * `can()`, service, RLS.
 *
 * ⚠️ Le chemin nomme un **projet**, jamais un environnement. `master` est
 * résolu par la route, et le mot n'apparaît nulle part dans l'API
 * (architecture/environments.md).
 */
type Session = { cookie: string; userId: string };

const call = (path: string, session: Session, init: RequestInit = {}) =>
  app.request(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      cookie: session.cookie,
      ...(init.headers as Record<string, string> | undefined),
    },
  });

const field = (name: string, type = "text", required = true) => ({
  name,
  type,
  validation: { required },
});

describe("types de contenu", () => {
  let owner: Session;
  let viewer: Session;
  const users: string[] = [];
  let organizationId = "";
  let base = "";

  before(async () => {
    const first = await createVerifiedUser("schema-owner");
    owner = { cookie: first.cookie, userId: first.id };
    const second = await createVerifiedUser("schema-viewer");
    viewer = { cookie: second.cookie, userId: second.id };
    users.push(first.id, second.id);

    const organization = await call("/api/organizations", owner, {
      method: "POST",
      body: JSON.stringify({ name: "Acme" }),
    });
    organizationId = ((await organization.json()) as { id: string }).id;

    await withContext({ userId: owner.userId, organizationId }, async (tx) => {
      const [role] = await tx
        .select()
        .from(roles)
        .where(and(eq(roles.organizationId, organizationId), eq(roles.name, "viewer")));
      assert.ok(role);
      await tx.insert(organizationMembers).values({
        organizationId,
        userId: viewer.userId,
        roleId: role.id,
      });
    });

    const project = await call(`/api/organizations/${organizationId}/projects`, owner, {
      method: "POST",
      body: JSON.stringify({ name: "Site" }),
    });
    const { id: projectId } = (await project.json()) as { id: string };
    base = `/api/organizations/${organizationId}/projects/${projectId}/schemas`;
  });

  after(async () => {
    await destroyOrganization(owner.userId, organizationId);
    await destroyUsers(users);
    await closePool();
  });

  it("crée un type de contenu et le liste", async () => {
    const created = await call(base, owner, {
      method: "POST",
      body: JSON.stringify({
        name: "article",
        label: "Article",
        definition: { fields: [field("title"), field("body", "longtext", false)] },
      }),
    });
    assert.equal(created.status, 201);

    const listed = await call(base, owner);
    const list = (await listed.json()) as { name: string; label: string | null }[];
    assert.ok(list.some((s) => s.name === "article" && s.label === "Article"));
  });

  it("refuse deux types de même nom dans le même environnement", async () => {
    const response = await call(base, owner, {
      method: "POST",
      body: JSON.stringify({
        name: "article",
        label: null,
        definition: { fields: [field("title")] },
      }),
    });
    assert.equal(response.status, 409);
  });

  /**
   * ⚠️ Postgres n'a rien à opposer à un doublon dans un tableau JSONB : deux
   * champs de même clé écraseraient silencieusement la donnée de l'un.
   */
  it("refuse deux champs partageant une clé de stockage", async () => {
    const response = await call(base, owner, {
      method: "POST",
      body: JSON.stringify({
        name: "doublon",
        label: null,
        definition: { fields: [field("title"), field("title", "longtext")] },
      }),
    });
    assert.equal(response.status, 409);
  });

  /**
   * ⚠️ La clé de stockage finit en propriété TypeScript et en clé JSONB.
   * La contrainte est posée maintenant, pas après que des noms arbitraires
   * existent chez des clients.
   */
  it("refuse un nom de champ qui n'est pas un identifiant", async () => {
    const response = await call(base, owner, {
      method: "POST",
      body: JSON.stringify({
        name: "mauvais",
        label: null,
        definition: { fields: [field("mon titre")] },
      }),
    });
    assert.equal(response.status, 400);
  });

  it("laisse un viewer lire sans écrire", async () => {
    assert.equal((await call(base, viewer)).status, 200, "`schema.read` suffit à lire");

    const written = await call(base, viewer, {
      method: "POST",
      body: JSON.stringify({
        name: "interdit",
        label: null,
        definition: { fields: [field("title")] },
      }),
    });
    assert.equal(written.status, 403, "modifier un schéma peut casser des documents");
  });

  /**
   * Les deux routes de lignée, par la chaîne complète.
   *
   * ⚠️ **Aucune permission nouvelle** : lire une lignée est une lecture de
   * schéma, restaurer est une écriture. C'est ce que ces deux cas vérifient —
   * le `viewer` lit et ne restaure pas.
   */
  describe("lignée", () => {
    let schemaId = "";
    let firstHash = "";

    before(async () => {
      const created = await call(base, owner, {
        method: "POST",
        body: JSON.stringify({
          name: "lineage",
          label: "Avant",
          definition: { fields: [field("title")] },
        }),
      });
      schemaId = ((await created.json()) as { id: string }).id;

      const history = await call(`${base}/${schemaId}/history`, owner);
      firstHash = ((await history.json()) as { currentHash: string }).currentHash;

      await call(`${base}/${schemaId}`, owner, {
        method: "PUT",
        body: JSON.stringify({
          name: "lineage",
          label: "Après",
          definition: { fields: [field("title"), field("body", "longtext", false)] },
        }),
      });
    });

    it("rend la lignée, du plus récent au plus ancien", async () => {
      const response = await call(`${base}/${schemaId}/history`, owner);
      assert.equal(response.status, 200);

      const body = (await response.json()) as {
        currentHash: string;
        entries: { action: string; hash: string; label: string | null }[];
      };
      assert.equal(body.entries.length, 2);
      assert.equal(body.entries[0]?.label, "Après");
      assert.equal(body.entries[1]?.label, "Avant");
      assert.equal(body.currentHash, body.entries[0]?.hash, "le pointeur voyage avec");
      assert.notEqual(body.currentHash, firstHash);
    });

    it("restaure, et l'écrit dans la lignée", async () => {
      const restored = await call(`${base}/${schemaId}/restore`, owner, {
        method: "POST",
        body: JSON.stringify({ hash: firstHash }),
      });
      assert.equal(restored.status, 200);
      assert.equal(((await restored.json()) as { label: string }).label, "Avant");

      const history = await call(`${base}/${schemaId}/history`, owner);
      const body = (await history.json()) as {
        currentHash: string;
        entries: { action: string }[];
      };
      assert.equal(body.currentHash, firstHash);
      assert.deepEqual(
        body.entries.map((entry) => entry.action),
        ["restored", "saved", "saved"],
        "le journal n'est jamais réécrit : l'aller-retour reste lisible",
      );
    });

    it("refuse une empreinte mal formée avant d'atteindre le service", async () => {
      const response = await call(`${base}/${schemaId}/restore`, owner, {
        method: "POST",
        body: JSON.stringify({ hash: "pas-une-empreinte" }),
      });
      assert.equal(response.status, 400);
    });

    it("laisse un viewer lire la lignée sans restaurer", async () => {
      assert.equal((await call(`${base}/${schemaId}/history`, viewer)).status, 200);

      const restored = await call(`${base}/${schemaId}/restore`, viewer, {
        method: "POST",
        body: JSON.stringify({ hash: firstHash }),
      });
      assert.equal(restored.status, 403);
    });
  });

  it("ne montre rien à un étranger", async () => {
    const stranger = await createVerifiedUser("schema-etranger");
    users.push(stranger.id);
    const response = await call(base, { cookie: stranger.cookie, userId: stranger.id });
    // 404 et non 403 : une organization qu'on n'atteint pas est indiscernable
    // d'une organization qui n'existe pas (ADR 0012).
    assert.equal(response.status, 404);
  });
});
