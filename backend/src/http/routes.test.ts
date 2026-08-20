import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { app } from "../app.ts";
import { closePool, withContext } from "../db/client.ts";
import {
  organizationMembers,
  organizations,
  projectMembers,
  roles,
} from "../db/schema.ts";

/**
 * Éprouve la chaîne complète : session, middleware, `can()`, service, RLS.
 *
 * Le point le plus important est la distinction 404 / 403 — un 403 sur une
 * organization dont on n'est pas membre en confirmerait l'existence
 * (ADR 0012).
 */
type Session = { cookie: string; userId: string };

async function signUp(prefix: string): Promise<Session> {
  const email = `${prefix}-${randomUUID()}@skafform.test`;
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "MotDePasseTest123!", name: prefix }),
  });
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "l'inscription doit poser un cookie de session");
  const body = (await response.json()) as { user: { id: string } };
  return { cookie, userId: body.user.id };
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
    await withContext({ userId: owner.userId, organizationId }, async (tx) => {
      await tx.delete(projectMembers);
      await tx.delete(organizationMembers);
    }).catch(() => {});
    await withContext({ userId: owner.userId, organizationId }, (tx) =>
      tx.delete(organizations).where(eq(organizations.id, organizationId)),
    ).catch(() => {});
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
});
