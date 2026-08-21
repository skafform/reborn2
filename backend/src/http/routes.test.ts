import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { app } from "../app.ts";
import { closePool, withContext } from "../db/client.ts";
import { organizationMembers, roles } from "../db/schema.ts";
import { destroyOrganization, destroyUsers } from "../test-support/cleanup.ts";
import { createVerifiedUser } from "../test-support/users.ts";

/**
 * Éprouve la chaîne complète : session, middleware, `can()`, service, RLS.
 *
 * Le point le plus important est la distinction 404 / 403 — un 403 sur une
 * organization dont on n'est pas membre en confirmerait l'existence
 * (ADR 0012).
 */
type Session = { cookie: string; userId: string; email: string };

async function signUp(prefix: string): Promise<Session> {
  const user = await createVerifiedUser(prefix);
  return { cookie: user.cookie, userId: user.id, email: user.email };
}

const call = (path: string, session: Session, init: RequestInit = {}) =>
  app.request(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      cookie: session.cookie,
      ...(init.headers as Record<string, string> | undefined),
    },
  });

describe("routes de gestion", () => {
  let owner: Session;
  let viewer: Session;
  let outsider: Session;
  let organizationId = "";

  before(async () => {
    owner = await signUp("owner");
    viewer = await signUp("viewer");
    outsider = await signUp("outsider");

    const response = await call("/api/organizations", owner, {
      method: "POST",
      body: JSON.stringify({ name: "Acme" }),
    });
    assert.equal(response.status, 201);
    organizationId = ((await response.json()) as { id: string }).id;

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
    await destroyUsers([owner.userId, viewer.userId, outsider.userId]);
    await closePool();
  });

  it("refuse une requête sans session", async () => {
    const response = await app.request("/api/organizations");
    assert.equal(response.status, 401);
  });

  it("ne liste que les organizations de l'utilisateur", async () => {
    const mine = await call("/api/organizations", owner);
    const list = (await mine.json()) as { id: string; role: string }[];
    assert.ok(list.some((o) => o.id === organizationId));
    assert.equal(list.find((o) => o.id === organizationId)?.role, "owner");

    const theirs = await call("/api/organizations", outsider);
    const empty = (await theirs.json()) as { id: string }[];
    assert.ok(!empty.some((o) => o.id === organizationId));
  });

  it("liste les membres avec leur rôle et leur adresse", async () => {
    const response = await call(`/api/organizations/${organizationId}/members`, owner);
    assert.equal(response.status, 200);

    const list = (await response.json()) as {
      userId: string;
      email: string;
      roleName: string;
    }[];

    assert.equal(list.length, 2, "le owner et le viewer ajouté à la préparation");
    assert.equal(list.find((m) => m.userId === owner.userId)?.roleName, "owner");
    assert.equal(list.find((m) => m.userId === viewer.userId)?.roleName, "viewer");
    assert.ok(
      list.every((m) => m.email.includes("@")),
      "l'adresse vient de la table de Better-Auth, jointe en SQL",
    );
  });

  it("laisse un viewer voir les membres, sans pouvoir inviter", async () => {
    const read = await call(`/api/organizations/${organizationId}/members`, viewer);
    assert.equal(read.status, 200, "un viewer est « un admin sans écriture »");

    const pending = await call(
      `/api/organizations/${organizationId}/invitations`,
      viewer,
    );
    assert.equal(
      pending.status,
      403,
      "une invitation en attente relève du recrutement, pas de l'annuaire",
    );

    // La séparation `member.read` / `member.manage` n'a de sens que si la
    // seconde reste refusée — sinon les deux permissions n'en feraient qu'une.
    //
    // Un vrai `roleId` est nécessaire : le service résout le rôle **avant**
    // d'appliquer la règle d'escalade, donc un identifiant inventé donnerait
    // un 404 « rôle introuvable » qui ne prouverait rien sur les permissions.
    const [viewerRole] = await withContext(
      { userId: owner.userId, organizationId },
      (tx) =>
        tx
          .select()
          .from(roles)
          .where(
            and(eq(roles.organizationId, organizationId), eq(roles.name, "viewer")),
          ),
    );
    assert.ok(viewerRole);

    const invite = await call(
      `/api/organizations/${organizationId}/invitations`,
      viewer,
      {
        method: "POST",
        body: JSON.stringify({ email: "x@skafform.test", roleId: viewerRole.id }),
      },
    );
    assert.equal(invite.status, 403);
  });

  it("expose les permissions de l'acteur, sans le nom du rôle", async () => {
    const asViewer = await call(`/api/organizations/${organizationId}/me`, viewer);
    assert.equal(asViewer.status, 200);
    const viewerPermissions = ((await asViewer.json()) as { permissions: string[] })
      .permissions;
    assert.ok(viewerPermissions.includes("member.read"));
    assert.ok(!viewerPermissions.includes("member.manage"));

    const asOwner = await call(`/api/organizations/${organizationId}/me`, owner);
    const ownerPermissions = ((await asOwner.json()) as { permissions: string[] })
      .permissions;
    assert.ok(ownerPermissions.includes("member.manage"));
  });

  it("ne montre pas les membres d'une organization à un étranger", async () => {
    const response = await call(
      `/api/organizations/${organizationId}/members`,
      outsider,
    );
    assert.equal(response.status, 404);
  });

  it("liste les rôles d'une organization, des deux portées", async () => {
    const response = await call(`/api/organizations/${organizationId}/roles`, owner);
    assert.equal(response.status, 200);

    const list = (await response.json()) as {
      name: string;
      scope: string;
      isSystem: boolean;
    }[];

    assert.deepEqual(
      list
        .filter((role) => role.scope === "organization")
        .map((r) => r.name)
        .sort(),
      ["admin", "owner", "viewer"],
    );
    assert.deepEqual(
      list
        .filter((role) => role.scope === "project")
        .map((r) => r.name)
        .sort(),
      ["contributor", "editor", "guest"],
    );
    assert.ok(
      list.every((role) => role.isSystem),
      "une organization neuve n'a que ses rôles système",
    );
  });

  it("refuse la liste des rôles à qui ne gère pas les membres", async () => {
    const response = await call(`/api/organizations/${organizationId}/roles`, viewer);
    assert.equal(
      response.status,
      403,
      "elle sert à attribuer un rôle, pas à en consulter le catalogue",
    );
  });

  it("ne montre pas les rôles d'une organization à un étranger", async () => {
    const response = await call(`/api/organizations/${organizationId}/roles`, outsider);
    assert.equal(
      response.status,
      404,
      "404 et non 403 : l'existence même de l'organization ne doit pas fuir",
    );
  });

  it("laisse le owner créer un projet", async () => {
    const response = await call(
      `/api/organizations/${organizationId}/projects`,
      owner,
      { method: "POST", body: JSON.stringify({ name: "Site Client A" }) },
    );
    assert.equal(response.status, 201);
  });

  it("répond 403 à un viewer qui tente de créer un projet", async () => {
    const response = await call(
      `/api/organizations/${organizationId}/projects`,
      viewer,
      { method: "POST", body: JSON.stringify({ name: "Interdit" }) },
    );
    assert.equal(
      response.status,
      403,
      "il voit l'organization : il n'y a plus rien à cacher",
    );
    const body = (await response.json()) as { reason: string };
    assert.equal(body.reason, "missing_permission");
  });

  it("laisse le viewer lire les projets", async () => {
    const response = await call(
      `/api/organizations/${organizationId}/projects`,
      viewer,
    );
    assert.equal(response.status, 200);
    const projects = (await response.json()) as unknown[];
    assert.ok(projects.length >= 1);
  });

  it("répond 404 — et non 403 — à un étranger", async () => {
    const read = await call(`/api/organizations/${organizationId}/projects`, outsider);
    assert.equal(read.status, 404, "un 403 confirmerait l'existence de l'organization");

    const write = await call(
      `/api/organizations/${organizationId}/projects`,
      outsider,
      { method: "POST", body: JSON.stringify({ name: "Intrusion" }) },
    );
    assert.equal(write.status, 404);
  });

  it("répond 404 sur une organization inexistante", async () => {
    const response = await call(`/api/organizations/${randomUUID()}/projects`, owner);
    assert.equal(
      response.status,
      404,
      "indiscernable d'une organization existante mais inaccessible",
    );
  });

  it("expose les routes dans la spec OpenAPI", async () => {
    const response = await app.request("/openapi.json");
    const spec = (await response.json()) as { paths: Record<string, unknown> };
    assert.ok(spec.paths["/api/organizations"]);
    assert.ok(spec.paths["/api/organizations/{organizationId}/projects"]);
  });

  /**
   * Régression du cas rencontré en éprouvant la console : se connecter
   * directement, sans passer par le lien de l'email, laissait une invitation
   * réelle invisible. `/api/inbox` retrouve par l'adresse de la session
   * vérifiée, jamais par une valeur envoyée par le client.
   */
  describe("Inbox", () => {
    it("montre une invitation en attente, l'accepte, puis n'en montre plus rien", async () => {
      const [viewerRole] = await withContext(
        { userId: owner.userId, organizationId },
        (tx) =>
          tx
            .select()
            .from(roles)
            .where(
              and(eq(roles.organizationId, organizationId), eq(roles.name, "viewer")),
            ),
      );
      assert.ok(viewerRole);

      const invited = await call(
        `/api/organizations/${organizationId}/invitations`,
        owner,
        {
          method: "POST",
          body: JSON.stringify({ email: outsider.email, roleId: viewerRole.id }),
        },
      );
      assert.equal(invited.status, 201);

      const before = await call("/api/inbox", outsider);
      assert.equal(before.status, 200);
      const pending = (await before.json()) as {
        id: string;
        organizationName: string;
      }[];
      assert.equal(pending.length, 1);
      assert.equal(pending[0]?.organizationName, "Acme");

      const accepted = await call(`/api/inbox/${pending[0]?.id}/accept`, outsider, {
        method: "POST",
      });
      assert.equal(accepted.status, 200);
      assert.equal(
        ((await accepted.json()) as { organizationId: string }).organizationId,
        organizationId,
      );

      const after = await call("/api/inbox", outsider);
      assert.deepEqual(await after.json(), []);

      // L'outsider est devenu membre — retiré ici pour ne pas fausser les
      // autres tests de ce fichier, qui le supposent extérieur à Acme.
      await withContext({ userId: owner.userId, organizationId }, (tx) =>
        tx
          .delete(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.userId, outsider.userId),
            ),
          ),
      );
    });

    it("ne montre rien sans session", async () => {
      const response = await app.request("/api/inbox");
      assert.equal(response.status, 401);
    });
  });
});
