import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { resolveActor } from "../auth/authorization.ts";
import { AuthorizationError } from "../auth/escalation.ts";
import { auth } from "../auth.ts";
import { INVITATION_RATE_LIMIT } from "../config/constants.ts";
import { closePool, withContext } from "../db/client.ts";
import { invitations, organizationMembers, roles } from "../db/schema.ts";
import { destroyOrganization, destroyUsers } from "../test-support/cleanup.ts";
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
const createdUsers: string[] = [];

async function makeUser(prefix: string) {
  const email = `${prefix}-${randomUUID()}@skafform.test`;
  const result = await auth.api.signUpEmail({
    body: { email, password: "MotDePasseTest123!", name: prefix },
  });
  createdUsers.push(result.user.id);
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
    await destroyOrganization(owner.id, organizationId);
    await destroyUsers(createdUsers);
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

  it("plafonne les invitations d'une organization", async () => {
    // Le compteur porte sur la fenêtre glissante, invitations annulées
    // comprises : sinon annuler puis réinviter contournerait le plafond.
    const actor = await resolveActor(owner.id, organizationId);
    await withContext({ userId: owner.id, organizationId }, (tx) =>
      tx.execute(
        sql`insert into invitations
              (organization_id, email, role_id, token_hash, expires_at)
            select ${organizationId}::uuid,
                   'saturation-' || g || '@skafform.test',
                   ${viewerRoleId}::uuid,
                   md5(random()::text || g),
                   now() + interval '7 days'
            from generate_series(1, ${INVITATION_RATE_LIMIT.count}) g`,
      ),
    );

    const target = await makeUser("plafond");
    await assert.rejects(
      () =>
        createInvitation({
          actor,
          invitedByName: "Owner",
          organizationId,
          organizationName: "Acme",
          email: target.email,
          roleId: viewerRoleId,
        }),
      (error: unknown) => {
        assert.ok(error instanceof InvitationError);
        assert.equal(error.status, 429);
        assert.equal(error.reason, "rate_limited");
        return true;
      },
      "un domaine signalé ferait tomber la délivrabilité de tous les emails",
    );

    await withContext({ userId: owner.id, organizationId }, (tx) =>
      tx.execute(sql`delete from invitations where email like 'saturation-%'`),
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

  describe("déjà membre", () => {
    const refusal = (error: unknown) => {
      assert.ok(error instanceof InvitationError);
      assert.equal(error.status, 409);
      assert.equal(error.reason, "already_member");
      return true;
    };

    it("refuse d'inviter quelqu'un déjà membre de l'organization", async () => {
      // Le cas rencontré en éprouvant la console : le owner s'invitant
      // lui-même. L'invitation partait et devenait inacceptable à jamais.
      await assert.rejects(() => invite(owner.email, viewerRoleId), refusal);
    });

    it("refuse quelle que soit la casse de l'adresse", async () => {
      await assert.rejects(
        () => invite(owner.email.toUpperCase(), viewerRoleId),
        refusal,
        "l'adresse est normalisée avant comparaison, des deux côtés",
      );
    });

    it("laisse inviter un membre de l'organization sur un projet", async () => {
      const membre = await makeUser("deja-org");
      const { token } = await invite(membre.email, viewerRoleId);
      await acceptInvitation({
        token,
        userId: membre.id,
        userEmail: membre.email,
      });

      // Appartenir à l'organization n'est pas appartenir au projet : le
      // contrôle vise ce que l'insertion violerait, rien de plus.
      await assert.doesNotReject(() => invite(membre.email, guestRoleId, projectId));
    });

    it("refuse d'inviter deux fois sur le même projet", async () => {
      const pigiste = await makeUser("deja-projet");
      const { token } = await invite(pigiste.email, guestRoleId, projectId);
      await acceptInvitation({
        token,
        userId: pigiste.id,
        userEmail: pigiste.email,
      });

      await assert.rejects(
        () => invite(pigiste.email, guestRoleId, projectId),
        refusal,
      );
    });

    /**
     * La course que le contrôle de création ne peut pas couvrir : l'adhésion
     * naît entre l'envoi et le clic. Seule la clé primaire tranche, et sa
     * violation doit se lire comme un refus, jamais comme un 500.
     */
    it("répond 409 si l'adhésion apparaît entre l'envoi et le clic", async () => {
      const rapide = await makeUser("course");
      const { token } = await invite(rapide.email, viewerRoleId);

      // Entre-temps, quelqu'un l'ajoute à la main. L'invitation reste valide
      // et son jeton intact : le contrôle de création ne peut rien contre cet
      // intervalle.
      await withContext({ userId: owner.id, organizationId }, (tx) =>
        tx.insert(organizationMembers).values({
          organizationId,
          userId: rapide.id,
          roleId: viewerRoleId,
        }),
      );

      await assert.rejects(
        () =>
          acceptInvitation({
            token,
            userId: rapide.id,
            userEmail: rapide.email,
          }),
        refusal,
      );
    });
  });
});
