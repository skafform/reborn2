import assert from "node:assert/strict";
import "../test-support/bootstrap.ts";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { app } from "../app.ts";
import { closePool, withContext } from "../db/client.ts";
import { organizationMembers, roles } from "../db/schema.ts";
import { destroyOrganization, destroyUsers } from "../test-support/cleanup.ts";
import { createVerifiedUser } from "../test-support/users.ts";
import { schemaVersions } from "./schema.ts";

/**
 * La bibliothèque de schémas d'une organization (ADR 0018), par la chaîne
 * complète : session, middleware, `can()`, service, RLS.
 *
 * ⚠️ **Aucun projet dans l'adresse.** Une entrée de bibliothèque appartient à
 * l'organization seule — c'est ce qui la distingue d'un type de contenu, et
 * l'API doit le dire.
 */
type Session = { cookie: string; userId: string };

const call = (path: string, session: Session, init: RequestInit = {}) =>
  app.request(path, {
    ...init,
    headers: { "Content-Type": "application/json", cookie: session.cookie },
  });

const field = (name: string, type = "text", required = true) => ({
  name,
  type,
  validation: { required },
});

describe("bibliothèque de schémas", () => {
  let owner: Session;
  let viewer: Session;
  const users: string[] = [];
  let organizationId = "";
  let base = "";

  before(async () => {
    const first = await createVerifiedUser("library-owner");
    owner = { cookie: first.cookie, userId: first.id };
    const second = await createVerifiedUser("library-viewer");
    viewer = { cookie: second.cookie, userId: second.id };
    users.push(first.id, second.id);

    const organization = await call("/api/organizations", owner, {
      method: "POST",
      body: JSON.stringify({ name: "Acme" }),
    });
    organizationId = ((await organization.json()) as { id: string }).id;
    base = `/api/organizations/${organizationId}/library`;

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
  });

  after(async () => {
    await destroyOrganization(owner.userId, organizationId);
    await destroyUsers(users);
    await closePool();
  });

  let authorId = "";
  let firstHash = "";

  it("ajoute un schéma et le liste avec son courant", async () => {
    const created = await call(base, owner, {
      method: "POST",
      body: JSON.stringify({
        name: "author",
        label: "Author",
        definition: { fields: [field("fullName")] },
      }),
    });
    assert.equal(created.status, 201);
    authorId = ((await created.json()) as { id: string }).id;

    const listed = await call(base, owner);
    const list = (await listed.json()) as { name: string; currentHash: string }[];
    const author = list.find((entry) => entry.name === "author");
    assert.ok(author);
    // ⚠️ Le courant voyage avec la ligne : c'est lui qu'une copie comparera.
    assert.match(author.currentHash, /^sha256-1:[0-9a-f]{64}$/);
    firstHash = author.currentHash;
  });

  /**
   * ⚠️ **Le cœur d'ADR 0018 côté stockage** : `schema_versions` est partagée
   * entre bibliothèque et types de contenu. Sans ça, « le hachage de la copie
   * est-il dans l'historique de la bibliothèque ? » n'aurait pas de sens.
   */
  it("écrit ses versions dans la table partagée, dédupliquée par organization", async () => {
    const stored = await withContext({ userId: owner.userId, organizationId }, (tx) =>
      tx
        .select({ name: schemaVersions.name })
        .from(schemaVersions)
        .where(eq(schemaVersions.hash, firstHash)),
    );
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.name, "author");
  });

  it("refuse deux schémas de même nom dans l'organization", async () => {
    const response = await call(base, owner, {
      method: "POST",
      body: JSON.stringify({
        name: "author",
        label: null,
        definition: { fields: [field("fullName")] },
      }),
    });
    assert.equal(response.status, 409);
  });

  it("n'écrit rien quand la définition enregistrée est celle qui est déjà là", async () => {
    const again = await call(`${base}/${authorId}`, owner, {
      method: "PUT",
      body: JSON.stringify({
        name: "author",
        label: "Author",
        definition: { fields: [field("fullName")] },
      }),
    });
    assert.equal(again.status, 200);

    const history = await call(`${base}/${authorId}/history`, owner);
    const body = (await history.json()) as { entries: unknown[] };
    assert.equal(
      body.entries.length,
      1,
      "le journal enregistre des états, pas des gestes",
    );
  });

  it("versionne, journalise et restaure", async () => {
    await call(`${base}/${authorId}`, owner, {
      method: "PUT",
      body: JSON.stringify({
        name: "author",
        label: "Auteur",
        definition: { fields: [field("fullName"), field("bio", "longtext", false)] },
      }),
    });

    const restored = await call(`${base}/${authorId}/restore`, owner, {
      method: "POST",
      body: JSON.stringify({ hash: firstHash }),
    });
    assert.equal(restored.status, 200);
    assert.equal(((await restored.json()) as { label: string }).label, "Author");

    const history = await call(`${base}/${authorId}/history`, owner);
    const body = (await history.json()) as {
      currentHash: string;
      entries: { action: string }[];
    };
    assert.equal(body.currentHash, firstHash);
    assert.deepEqual(
      body.entries.map((entry) => entry.action),
      ["restored", "saved", "saved"],
    );
  });

  /**
   * ⚠️ **`library.write` est une clé à part**, et c'est ce test qui le prouve :
   * `schema.read` suffit à regarder la bibliothèque, jamais à la modifier. Un
   * `viewer` en a la lecture et rien de plus.
   */
  it("laisse un viewer lire la bibliothèque sans la modifier", async () => {
    assert.equal((await call(base, viewer)).status, 200);
    assert.equal((await call(`${base}/${authorId}/history`, viewer)).status, 200);

    const written = await call(base, viewer, {
      method: "POST",
      body: JSON.stringify({
        name: "interdit",
        label: null,
        definition: { fields: [field("title")] },
      }),
    });
    assert.equal(written.status, 403);

    const deleted = await call(`${base}/${authorId}`, viewer, { method: "DELETE" });
    assert.equal(deleted.status, 403);
  });

  it("ne montre rien à un étranger", async () => {
    const stranger = await createVerifiedUser("library-etranger");
    users.push(stranger.id);
    const response = await call(base, {
      cookie: stranger.cookie,
      userId: stranger.id,
    });
    // 404, jamais 403 : une organization qu'on n'atteint pas est indiscernable
    // d'une organization qui n'existe pas (ADR 0012).
    assert.equal(response.status, 404);
  });

  it("retire un schéma de la bibliothèque", async () => {
    assert.equal(
      (await call(`${base}/${authorId}`, owner, { method: "DELETE" })).status,
      204,
    );

    const listed = await call(base, owner);
    const list = (await listed.json()) as { id: string }[];
    assert.ok(!list.some((entry) => entry.id === authorId));

    // ⚠️ Les versions survivent, comme pour un type de contenu : elles sont du
    // contenu partagé par l'organization.
    const stored = await withContext({ userId: owner.userId, organizationId }, (tx) =>
      tx
        .select({ hash: schemaVersions.hash })
        .from(schemaVersions)
        .where(eq(schemaVersions.hash, firstHash)),
    );
    assert.equal(stored.length, 1);
  });
});
