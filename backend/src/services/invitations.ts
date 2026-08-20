import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Actor } from "../auth/authorization.ts";
import { AuthorizationError, requireCanAssignRole } from "../auth/escalation.ts";
import {
  DAY_IN_MS,
  INVITATION_EXPIRY_DAYS,
  INVITATION_RATE_LIMIT,
  INVITATION_TOKEN_BYTES,
} from "../config/constants.ts";
import { env } from "../config/env.ts";
import type { Permission } from "../config/permissions.ts";
import { type Transaction, withContext } from "../db/client.ts";
import {
  invitations,
  organizationMembers,
  organizations,
  projectMembers,
  rolePermissions,
  roles,
} from "../db/schema.ts";
import { mailer } from "../mail/mailer.ts";
import { render } from "../mail/template.ts";
import { invitationEmail } from "../mail/templates/invitation.ts";

/**
 * Invitations à rejoindre une organization ou un projet.
 *
 * Le jeton n'est **jamais stocké** : seul son hachage l'est, et le jeton clair
 * ne vit que dans l'email. Si la base fuit, les invitations en attente restent
 * inutilisables — même raisonnement que pour la clé API secrète.
 */

export class InvitationError extends Error {
  readonly status: 404 | 409 | 410 | 429;
  readonly reason: string;

  constructor(status: 404 | 409 | 410 | 429, reason: string, message: string) {
    super(message);
    this.name = "InvitationError";
    this.status = status;
    this.reason = reason;
  }
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Le comptage se fait sur la table elle-même : `created_at` et
 * `organization_id` y sont déjà, donc aucun stockage supplémentaire. Les
 * invitations annulées comptent — sinon annuler puis réinviter contournerait
 * le plafond.
 */
async function assertUnderRateLimit(tx: Transaction, organizationId: string) {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        sql`${invitations.createdAt} > now() - make_interval(hours => ${INVITATION_RATE_LIMIT.windowHours})`,
      ),
    );

  if ((row?.count ?? 0) >= INVITATION_RATE_LIMIT.count) {
    throw new InvitationError(
      429,
      "rate_limited",
      `plafond de ${INVITATION_RATE_LIMIT.count} invitations par ${INVITATION_RATE_LIMIT.windowHours} h atteint`,
    );
  }
}

export async function createInvitation(input: {
  actor: Actor;
  invitedByName: string;
  organizationId: string;
  organizationName: string;
  email: string;
  roleId: string;
  projectId?: string;
}): Promise<{ id: string; token: string }> {
  const { actor, organizationId } = input;
  const email = input.email.trim().toLowerCase();

  const token = randomBytes(INVITATION_TOKEN_BYTES).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * DAY_IN_MS);

  const id = await withContext({ userId: actor.userId, organizationId }, async (tx) => {
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.id, input.roleId)));
    if (!role) {
      throw new InvitationError(404, "unknown_role", "rôle introuvable");
    }

    const granted = await tx
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, role.id));

    // Inviter, c'est accorder : la règle d'escalade s'applique ici comme à
    // l'assignation directe (ADR 0011).
    requireCanAssignRole(actor, {
      name: role.name,
      isSystem: role.isSystem,
      permissions: granted.map((g) => g.key as Permission),
    });

    await assertUnderRateLimit(tx, organizationId);

    // Une invitation expirée occupe encore l'index d'unicité : l'annuler
    // libère la place. `now()` ne pouvant figurer dans un prédicat d'index,
    // c'est ici que la distinction se fait.
    await tx
      .update(invitations)
      .set({ cancelledAt: new Date() })
      .where(
        and(
          eq(invitations.organizationId, organizationId),
          eq(invitations.email, email),
          isNull(invitations.acceptedAt),
          isNull(invitations.cancelledAt),
          sql`${invitations.expiresAt} <= now()`,
        ),
      );

    const [created] = await tx
      .insert(invitations)
      .values({
        organizationId,
        projectId: input.projectId ?? null,
        email,
        roleId: role.id,
        tokenHash,
        invitedBy: actor.userId,
        expiresAt,
      })
      .returning({ id: invitations.id })
      .catch((error: unknown) => {
        // 23505 : une invitation active existe déjà pour cette cible.
        if ((error as { cause?: { code?: string } }).cause?.code === "23505") {
          throw new InvitationError(
            409,
            "already_invited",
            "une invitation est déjà en cours pour cette adresse",
          );
        }
        throw error;
      });

    if (!created) throw new Error("invitation insert returned no row");
    return created.id;
  });

  const rendered = render(invitationEmail, {
    organizationName: input.organizationName,
    inviterName: input.invitedByName,
    acceptUrl: `${env.PLATFORM_URL}/invitations/accept?token=${token}`,
    expiresInDays: INVITATION_EXPIRY_DAYS,
  });
  await mailer.send({ ...rendered, to: email });

  return { id, token };
}

/** Ce qu'un porteur de jeton peut voir avant d'accepter. */
export function describeInvitation(token: string) {
  return withContext({ invitationTokenHash: hashToken(token) }, async (tx) => {
    const [row] = await tx
      .select({
        email: invitations.email,
        organizationName: organizations.name,
        roleName: roles.name,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        cancelledAt: invitations.cancelledAt,
      })
      .from(invitations)
      .innerJoin(roles, eq(roles.id, invitations.roleId))
      .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
      .where(eq(invitations.tokenHash, hashToken(token)));

    if (!row) {
      throw new InvitationError(404, "unknown_token", "invitation introuvable");
    }
    if (row.acceptedAt || row.cancelledAt || row.expiresAt <= new Date()) {
      throw new InvitationError(410, "expired", "invitation expirée");
    }
    return {
      email: row.email,
      organizationName: row.organizationName,
      roleName: row.roleName,
    };
  });
}

/**
 * Accepte une invitation.
 *
 * L'email de l'acceptant doit correspondre **exactement** à celui de
 * l'invitation : sans quoi un lien transféré ferait entrer quelqu'un d'autre.
 *
 * L'acceptation se fait par une mise à jour conditionnelle — si l'invitation a
 * été annulée entre-temps, aucune ligne n'est touchée et rien n'est créé.
 */
export async function acceptInvitation(input: {
  token: string;
  userId: string;
  userEmail: string;
}): Promise<{ organizationId: string; projectId: string | null }> {
  const tokenHash = hashToken(input.token);

  const invitation = await withContext(
    { invitationTokenHash: tokenHash, userId: input.userId },
    async (tx) => {
      const [row] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.tokenHash, tokenHash));
      if (!row) {
        throw new InvitationError(404, "unknown_token", "invitation introuvable");
      }
      return row;
    },
  );

  if (invitation.email !== input.userEmail.trim().toLowerCase()) {
    throw new AuthorizationError(
      "cette invitation vise une autre adresse",
      "missing_permission",
    );
  }

  return withContext(
    {
      userId: input.userId,
      organizationId: invitation.organizationId,
      invitationTokenHash: tokenHash,
    },
    async (tx) => {
      const consumed = await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(invitations.id, invitation.id),
            isNull(invitations.acceptedAt),
            isNull(invitations.cancelledAt),
            sql`${invitations.expiresAt} > now()`,
          ),
        )
        .returning({ id: invitations.id });

      if (consumed.length === 0) {
        throw new InvitationError(410, "expired", "invitation expirée");
      }

      if (invitation.projectId) {
        // Une invitation à un projet ne crée **jamais** d'adhésion à
        // l'organization (architecture/invitations.md).
        await tx.insert(projectMembers).values({
          projectId: invitation.projectId,
          organizationId: invitation.organizationId,
          userId: input.userId,
          roleId: invitation.roleId,
        });
      } else {
        await tx.insert(organizationMembers).values({
          organizationId: invitation.organizationId,
          userId: input.userId,
          roleId: invitation.roleId,
        });
      }

      return {
        organizationId: invitation.organizationId,
        projectId: invitation.projectId,
      };
    },
  );
}

/** Annule une invitation en attente. */
export async function cancelInvitation(input: {
  actor: Actor;
  organizationId: string;
  invitationId: string;
}): Promise<void> {
  await withContext(
    { userId: input.actor.userId, organizationId: input.organizationId },
    async (tx) => {
      const cancelled = await tx
        .update(invitations)
        .set({ cancelledAt: new Date() })
        .where(
          and(
            eq(invitations.id, input.invitationId),
            isNull(invitations.acceptedAt),
            isNull(invitations.cancelledAt),
          ),
        )
        .returning({ id: invitations.id });

      if (cancelled.length === 0) {
        throw new InvitationError(
          404,
          "not_pending",
          "aucune invitation en attente pour cet identifiant",
        );
      }
    },
  );
}

/** Les invitations en attente d'une organization. */
export function listPendingInvitations(userId: string, organizationId: string) {
  return withContext({ userId, organizationId }, (tx) =>
    tx
      .select({
        id: invitations.id,
        email: invitations.email,
        roleName: roles.name,
        projectId: invitations.projectId,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .innerJoin(roles, eq(roles.id, invitations.roleId))
      .where(
        and(
          eq(invitations.organizationId, organizationId),
          isNull(invitations.acceptedAt),
          isNull(invitations.cancelledAt),
        ),
      ),
  );
}
