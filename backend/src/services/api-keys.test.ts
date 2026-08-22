import assert from "node:assert/strict";
import "../test-support/bootstrap.ts";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { resolveActor } from "../auth/authorization.ts";
import { AuthorizationError } from "../auth/escalation.ts";
import { auth } from "../auth.ts";
import { closePool, withContext } from "../db/client.ts";
import { organizationMembers, roles } from "../db/schema.ts";
import { destroyOrganization, destroyUsers } from "../test-support/cleanup.ts";
import {
  ApiKeyError,
  createApiKey,
  deleteApiKey,
  listApiKeys,
  masterEnvironment,
  resolveApiKey,
  revokeApiKey,
} from "./api-keys.ts";
import { createOrganization, createProject } from "./organizations.ts";

const createdUsers: string[] = [];

async function makeUser(prefix: string) {
  const email = `${prefix}-${randomUUID()}@skafform.test`;
  const result = await auth.api.signUpEmail({
    body: { email, password: "MotDePasseTest123!", name: prefix },
  });
  createdUsers.push(result.user.id);
  return { id: result.user.id, email };
}

describe("clés API", () => {
  let owner: { id: string; email: string };
  let organizationId = "";
  let environmentId = "";

  before(async () => {
    owner = await makeUser("owner");
    const organization = await createOrganization({
      userId: owner.id,
      name: "Acme",
    });
    organizationId = organization.id;
    const project = await createProject({
      userId: owner.id,
      organizationId,
      name: "Site",
    });
    environmentId = await masterEnvironment(owner.id, organizationId, project.id);
  });

  after(async () => {
    await destroyOrganization(owner.id, organizationId);
    await destroyUsers(createdUsers);
    await closePool();
  });

  const create = async (kind: "public" | "preview" | "secret") => {
    const actor = await resolveActor(owner.id, organizationId);
    return createApiKey({
      actor,
      organizationId,
      environmentId,
      kind,
      name: `clé ${kind}`,
    });
  };

  it("un projet naît avec son environnement master", () => {
    assert.ok(environmentId, "master doit exister sans intervention");
  });

  describe("stockage", () => {
    it("garde les clés publique et preview consultables", async () => {
      const { token } = await create("public");
      const keys = await listApiKeys(
        await resolveActor(owner.id, organizationId),
        organizationId,
        environmentId,
      );
      const stored = keys.find((k) => k.kind === "public");
      assert.equal(stored?.token, token, "on doit pouvoir la recopier dans un site");
    });

    it("ne révèle jamais la clé secrète après sa création", async () => {
      const { token } = await create("secret");
      const keys = await listApiKeys(
        await resolveActor(owner.id, organizationId),
        organizationId,
        environmentId,
      );
      const stored = keys.find((k) => k.kind === "secret");
      assert.equal(stored?.token, null, "seul le hachage est conservé");
      assert.ok(stored?.hint.startsWith("sk_"), "le préfixe reste affichable");
      assert.ok(!stored?.hint.includes(token.slice(10)));
    });
  });

  describe("résolution", () => {
    it("une clé se résout sans contexte d'organization", async () => {
      const { token } = await create("public");
      const resolved = await resolveApiKey(token);
      assert.equal(
        resolved?.organizationId,
        organizationId,
        "la clé détermine le locataire, elle ne le suppose pas",
      );
      assert.equal(resolved?.environmentId, environmentId);
      assert.equal(resolved?.kind, "public", "le type est rendu, pas interprété");
    });

    it("un jeton inconnu ne résout rien", async () => {
      assert.equal(await resolveApiKey("pk_inexistant"), null);
    });

    it("une clé révoquée ne résout plus rien", async () => {
      const { id, token } = await create("public");
      const actor = await resolveActor(owner.id, organizationId);
      await revokeApiKey({ actor, organizationId, apiKeyId: id });
      assert.equal(await resolveApiKey(token), null);
    });
  });

  describe("cycle de vie", () => {
    it("interdit de supprimer une clé encore active", async () => {
      const { id } = await create("public");
      const actor = await resolveActor(owner.id, organizationId);

      await assert.rejects(
        () => deleteApiKey({ actor, organizationId, apiKeyId: id }),
        (error: unknown) => {
          assert.ok(error instanceof ApiKeyError);
          assert.equal(error.status, 409);
          assert.equal(error.reason, "not_revoked");
          return true;
        },
        "sans révocation préalable, on ne saurait plus si elle circulait",
      );
    });

    it("laisse supprimer une clé révoquée", async () => {
      const { id } = await create("public");
      const actor = await resolveActor(owner.id, organizationId);
      await revokeApiKey({ actor, organizationId, apiKeyId: id });
      await assert.doesNotReject(() =>
        deleteApiKey({ actor, organizationId, apiKeyId: id }),
      );
    });
  });

  describe("autorisation", () => {
    it("un viewer ne peut pas gérer les clés", async () => {
      const viewer = await makeUser("viewer");
      await withContext({ userId: owner.id, organizationId }, async (tx) => {
        const [role] = await tx
          .select()
          .from(roles)
          .where(
            and(eq(roles.organizationId, organizationId), eq(roles.name, "viewer")),
          );
        assert.ok(role);
        await tx.insert(organizationMembers).values({
          organizationId,
          userId: viewer.id,
          roleId: role.id,
        });
      });

      const actor = await resolveActor(viewer.id, organizationId);
      await assert.rejects(
        () =>
          createApiKey({
            actor,
            organizationId,
            environmentId,
            kind: "secret",
            name: "interdite",
          }),
        (error: unknown) => {
          assert.ok(error instanceof AuthorizationError);
          assert.equal(error.status, 403);
          return true;
        },
      );
    });
  });
});
