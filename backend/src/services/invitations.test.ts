import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { resolveActor } from "../auth/authorization.ts";
import { AuthorizationError } from "../auth/escalation.ts";
import { auth } from "../auth.ts";
import { closePool, withContext } from "../db/client.ts";
import {
  invitations,
  organizationMembers,
  organizations,
  projectMembers,
  roles,
} from "../db/schema.ts";
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  describeInvitation,
  InvitationError,
  listPendingInvitations,
} from "./invitations.ts";
import { createOrganization, createProject } from "./organizations.ts";

/**
 * Les emails ne partent nulle part : sans `RESEND_API_KEY`, le mailer bascule
 * sur la console. Les tests n'en dépendent pas — ils vérifient le jeton
 * retourné, pas le message.
 */
async function makeUser(prefix: string) {
  const email = `${prefix}-${randomUUID()}@skafform.test`;
  const result = await auth.api.signUpEmail({
    body: { email, password: "MotDePasseTest123!", name: prefix },
  });
  return { id: result.user.id, email };
}

async function roleIdFor(organizationId: string, ownerId: string, name: string) {
  return withContext({ userId: ownerId, organizationId }, async (tx) => {
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.name, name)));
    assert.ok(role, `rôle ${name} introuvable`);
    return role.id;
  });
}

describe("invitations", () => {
  let owner: { id: string; email: string };
  let organizationId = "";
  let projectId = "";
  let viewerRoleId = "";
  let ownerRoleId = "";
  let guestRoleId = "";

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
    projectId = project.id;

    viewerRoleId = await roleIdFor(organizationId, owner.id, "viewer");
    ownerRoleId = await roleIdFor(organizationId, owner.id, "owner");
    guestRoleId = await roleIdFor(organizationId, owner.id, "guest");
  });

  after(async () => {
    await withContext({ userId: owner.id, organizationId }, async (tx) => {
      await tx.delete(invitations);
      await tx.delete(projectMembers);
      await tx.delete(organizationMembers);
    }).catch(() => {});
    await withContext({ userId: owner.id, organizationId }, (tx) =>
      tx.delete(organizations).where(eq(organizations.id, organizationId)),
    ).catch(() => {});
    await closePool();
  });

  const invite = async (email: string, roleId: string, projectId?: string) => {
    const actor = await resolveActor(owner.id, organizationId);
    return createInvitation({
      actor,
      invitedByName: "Owner",
      organizationId,
      organizationName: "Acme",
      email,
      roleId,
      ...(projectId ? { projectId } : {}),
    });
  };

  it("le jeton clair n'est jamais stocké", async () => {
    const guest = await makeUser("guest");
    const { token } = await invite(guest.email, viewerRoleId);

    const stored = await withContext({ userId: owner.id, organizationId }, (tx) =>
      tx
        .select({ hash: invitations.tokenHash })
        .from(invitations)
        .where(eq(invitations.email, guest.email)),
    );
    assert.equal(stored.length, 1);
    assert.notEqual(stored[0]?.hash, token, "seul le hachage doit être en base");
    assert.equal(stored[0]?.hash?.length, 64, "SHA-256 en hexadécimal");
  });

  it("le porteur du jeton voit son invitation avant d'être membre", async () => {
    const guest = await makeUser("guest");
    const { token } = await invite(guest.email, viewerRoleId);

    const described = await describeInvitation(token);
    assert.equal(described.email, guest.email);
    assert.equal(described.organizationName, "Acme");
    assert.equal(described.roleName, "viewer");
  });

  it("un jeton inconnu ne révèle rien", async () => {
    await assert.rejects(
      () => describeInvitation("jeton-inexistant"),
      (error: unknown) => {
        assert.ok(error instanceof InvitationError);
        assert.equal(error.status, 404);
        return true;
      },
    );
  });

  it("rejoindre l'organization avec le bon email", async () => {
    const guest = await makeUser("guest");
    const { token } = await invite(guest.email, viewerRoleId);

    const result = await acceptInvitation({
      token,
      userId: guest.id,
      userEmail: guest.email,
    });
    assert.equal(result.organizationId, organizationId);

    const actor = await resolveActor(guest.id, organizationId);
    assert.equal(actor.grant?.scope, "organization");
  });

  it("refuse un lien transféré à une autre adresse", async () => {
    const invited = await makeUser("invited");
    const other = await makeUser("other");
    const { token } = await invite(invited.email, viewerRoleId);

    await assert.rejects(
      () =>
        acceptInvitation({
          token,
          userId: other.id,
          userEmail: other.email,
        }),
      (error: unknown) => {
        assert.ok(error instanceof AuthorizationError);
        return true;
      },
      "l'email verrouille le destinataire prévu",
    );
  });

  it("un jeton ne sert qu'une fois", async () => {
    const guest = await makeUser("guest");
    const { token } = await invite(guest.email, viewerRoleId);
    await acceptInvitation({ token, userId: guest.id, userEmail: guest.email });

    await assert.rejects(
      () => acceptInvitation({ token, userId: guest.id, userEmail: guest.email }),
      (error: unknown) => {
        assert.ok(error instanceof InvitationError);
        assert.equal(error.status, 410);
        return true;
      },
    );
  });

  it("refuse une seconde invitation active pour la même adresse", async () => {
    const guest = await makeUser("guest");
    await invite(guest.email, viewerRoleId);

    await assert.rejects(
      () => invite(guest.email, viewerRoleId),
      (error: unknown) => {
        assert.ok(error instanceof InvitationError);
        assert.equal(error.status, 409);
        assert.equal(error.reason, "already_invited");
        return true;
      },
    );
  });

  it("une invitation à un projet ne crée pas d'adhésion à l'organization", async () => {
    const guest = await makeUser("pigiste");
    const { token } = await invite(guest.email, guestRoleId, projectId);
    const result = await acceptInvitation({
      token,
      userId: guest.id,
      userEmail: guest.email,
    });
    assert.equal(result.projectId, projectId);

    const actor = await resolveActor(guest.id, organizationId);
    assert.equal(actor.grant?.scope, "project", "il reste extérieur à l'organization");
    assert.deepEqual(actor.grant?.projectIds, [projectId]);
  });

  it("empêche d'inviter à un rôle plus puissant que soi", async () => {
    const admin = await makeUser("admin");
    const adminRoleId = await roleIdFor(organizationId, owner.id, "admin");
    const { token } = await invite(admin.email, adminRoleId);
    await acceptInvitation({
      token,
      userId: admin.id,
      userEmail: admin.email,
    });

    const adminActor = await resolveActor(admin.id, organizationId);
    const target = await makeUser("cible");

    await assert.rejects(
      () =>
        createInvitation({
          actor: adminActor,
          invitedByName: "Admin",
          organizationId,
          organizationName: "Acme",
          email: target.email,
          roleId: ownerRoleId,
        }),
      (error: unknown) => {
        assert.ok(error instanceof AuthorizationError);
        assert.equal(error.status, 403);
        return true;
      },
      "inviter, c'est accorder : la règle d'escalade s'applique",
    );
  });

  it("annule une invitation en attente", async () => {
    const guest = await makeUser("annule");
    const { id } = await invite(guest.email, viewerRoleId);
    const actor = await resolveActor(owner.id, organizationId);

    await cancelInvitation({ actor, organizationId, invitationId: id });

    const pending = await listPendingInvitations(owner.id, organizationId);
    assert.ok(!pending.some((p) => p.id === id));
  });

  it("une invitation annulée ne peut plus être acceptée", async () => {
    const guest = await makeUser("annule2");
    const { id, token } = await invite(guest.email, viewerRoleId);
    const actor = await resolveActor(owner.id, organizationId);
    await cancelInvitation({ actor, organizationId, invitationId: id });

    await assert.rejects(
      () => acceptInvitation({ token, userId: guest.id, userEmail: guest.email }),
      (error: unknown) => {
        assert.ok(error instanceof InvitationError);
        assert.equal(error.status, 410);
        return true;
      },
    );
  });
});
