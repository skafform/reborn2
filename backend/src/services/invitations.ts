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
  projects,
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

/**
 * `422` et non `400` : la requête est bien formée, c'est sa *combinaison* qui
 * ne tient pas. Zod occupe déjà le 400 à la frontière des routes — les
 * confondre empêcherait un client de distinguer un corps mal formé d'un refus
 * de fond.
 */
export class InvitationError extends Error {
  readonly status: 404 | 409 | 410 | 422 | 429;
  readonly reason: string;

  constructor(status: 404 | 409 | 410 | 422 | 429, reason: string, message: string) {
    super(message);
    this.name = "InvitationError";
    this.status = status;
    this.reason = reason;
  }
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Refuse d'inviter quelqu'un qui est déjà là.
 *
 * Sans ce contrôle, l'invitation partait et devenait **inacceptable à jamais** :
 * l'acceptation insère dans `organization_members`, dont la clé primaire est
 * `(organization_id, user_id)`, et la violation remontait en 500.
 *
 * Le contrôle vise exactement ce que cette insertion violerait — l'adhésion à
 * l'organization pour une invitation d'organization, l'adhésion au projet pour
 * une invitation de projet. Un membre de l'organization peut donc toujours
 * être invité sur un projet, ce qui est le cas normal.
 *
 * ⚠️ Ce n'est pas le moyen de **changer** le rôle de quelqu'un. Inviter un
 * `owner` en `admin` serait une rétrogradation déguisée ; le changement de
 * rôle est une opération distincte, avec son propre garde-fou d'escalade.
 */
async function assertAlreadyNotMember(
  tx: Transaction,
  target: { organizationId: string; email: string; projectId: string | null },
) {
  // `"user"` appartient à Better-Auth et n'est pas déclarée dans le schéma
  // Drizzle (ADR 0002) : la jointure passe donc par du SQL, avec des valeurs
  // paramétrées. `user` est aussi un mot réservé, d'où les guillemets.
  const [row] = target.projectId
    ? await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, target.projectId),
            sql`exists (select 1 from "user" u
                        where u.id = ${projectMembers.userId}
                          and lower(u.email) = ${target.email})`,
          ),
        )
    : await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, target.organizationId),
            sql`exists (select 1 from "user" u
                        where u.id = ${organizationMembers.userId}
                          and lower(u.email) = ${target.email})`,
          ),
        );

  if ((row?.count ?? 0) > 0) {
    throw new InvitationError(
      409,
      "already_member",
      target.projectId
        ? "cette adresse est déjà membre du projet"
        : "cette adresse est déjà membre de l'organization",
    );
  }
}

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

    // La portée du rôle et l'endroit où on l'attribue doivent s'accorder.
    //
    // Le garde-fou ci-dessus ne le voit pas : il compare des **permissions**,
    // pas leur étendue. Un rôle de projet invité sans projet devenait une
    // adhésion d'organization, et ses permissions valaient alors sur *tous*
    // les projets — une escalade de portée, sans escalade de privilèges.
    if (role.scope === "project" && !input.projectId) {
      throw new InvitationError(
        422,
        "scope_mismatch",
        "un rôle de projet s'attribue toujours avec un projet",
      );
    }
    if (role.scope === "organization" && input.projectId) {
      throw new InvitationError(
        422,
        "scope_mismatch",
        "un rôle d'organization ne s'attribue pas sur un projet",
      );
    }

    // Le projet doit être un projet de cette organization. `invitations` ne
    // porte pas la clé étrangère composite qui le garantit sur
    // `project_members` : sans ce contrôle l'invitation partait, puis devenait
    // **inacceptable** — la contrainte ne se réveillait qu'à l'insertion de
    // l'adhésion.
    if (input.projectId) {
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, organizationId),
            eq(projects.id, input.projectId),
          ),
        );
      if (!project) {
        throw new InvitationError(404, "unknown_project", "projet introuvable");
      }
    }

    await assertAlreadyNotMember(tx, {
      organizationId,
      email,
      projectId: input.projectId ?? null,
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
        // `null` pour une invitation d'organization — d'où la jointure
        // gauche, et non interne comme les deux autres.
        projectName: projects.name,
        roleName: roles.name,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        cancelledAt: invitations.cancelledAt,
      })
      .from(invitations)
      .innerJoin(roles, eq(roles.id, invitations.roleId))
      .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
      .leftJoin(projects, eq(projects.id, invitations.projectId))
      .where(eq(invitations.tokenHash, hashToken(token)));

    if (!row) {
      throw new InvitationError(404, "unknown_token", "invitation introuvable");
    }
    if (row.acceptedAt || row.cancelledAt || row.expiresAt <= new Date()) {
      throw new InvitationError(410, "expired", "invitation expirée");
    }

    /**
     * L'adresse a-t-elle déjà un compte ? L'écran d'acceptation propose alors
     * *soit* la connexion, *soit* l'inscription, au lieu de faire deviner.
     *
     * Ce n'est pas une fuite d'énumération de comptes : la règle d'OWASP vise
     * le formulaire de connexion public, où l'attaquant choisit librement
     * l'adresse à tester. Ici elle est fixée par l'invitation, et il faut le
     * jeton — un secret, déjà validé ci-dessus — pour arriver jusqu'ici. Le
     * porteur du jeton connaît de toute façon l'adresse visée. Clerk va plus
     * loin en mettant ce statut dans l'URL du courriel elle-même.
     *
     * `lower()` des deux côtés : `invitations.email` est normalisé à la
     * création, `"user".email` ne l'est pas — même précaution que dans les
     * policies RLS.
     *
     * `"user"` appartient à Better-Auth, hors du schéma Drizzle (ADR 0002) :
     * d'où le SQL, avec une valeur paramétrée.
     */
    const account = await tx.execute(
      sql`select 1 from "user" where lower(email) = ${row.email} limit 1`,
    );

    return {
      email: row.email,
      organizationName: row.organizationName,
      projectName: row.projectName,
      roleName: row.roleName,
      // `tx.execute` renvoie le résultat pg complet, pas un tableau de lignes :
      // le destructurer donnerait toujours `undefined`, silencieusement.
      hasAccount: (account.rowCount ?? 0) > 0,
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

  return finalizeAcceptance(invitation, input.userId);
}

/**
 * Les invitations en attente adressées à une adresse, tous locataires
 * confondus — l'Inbox. La visibilité vient de la policy RLS `email =
 * app_current_user_email()` (migration 0020) : cette adresse est celle de la
 * session vérifiée, jamais une valeur fournie par le client.
 */
export function listReceivedInvitations(userId: string, email: string) {
  return withContext({ userId, userEmail: email }, (tx) =>
    tx
      .select({
        id: invitations.id,
        organizationName: organizations.name,
        // « Ideatrove — editor » ne dit pas *sur quoi*. `null` pour une
        // invitation d'organization, d'où la jointure gauche.
        projectName: projects.name,
        roleName: roles.name,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
      .innerJoin(roles, eq(roles.id, invitations.roleId))
      .leftJoin(projects, eq(projects.id, invitations.projectId))
      .where(
        and(
          isNull(invitations.acceptedAt),
          isNull(invitations.cancelledAt),
          sql`${invitations.expiresAt} > now()`,
        ),
      ),
  );
}

/**
 * Accepte une invitation retrouvée dans l'Inbox — sans jeton, puisque seul son
 * hachage est stocké ; l'Inbox ne l'a jamais eu en main, contrairement au lien
 * reçu par email.
 *
 * Pas de second contrôle d'adresse en JavaScript ici : la policy RLS
 * `email = app_current_user_email()` **est** le contrôle. Si la ligne n'est
 * pas visible, elle n'existe pas pour cette personne (ADR 0012).
 */
export async function acceptReceivedInvitation(input: {
  invitationId: string;
  userId: string;
  userEmail: string;
}): Promise<{ organizationId: string; projectId: string | null }> {
  const invitation = await withContext(
    { userId: input.userId, userEmail: input.userEmail },
    async (tx) => {
      const [row] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.id, input.invitationId));
      if (!row) {
        throw new InvitationError(404, "unknown_token", "invitation introuvable");
      }
      return row;
    },
  );

  return finalizeAcceptance(invitation, input.userId);
}

/**
 * Le cœur commun aux deux chemins d'acceptation — par jeton ou depuis
 * l'Inbox. Ce qui diffère entre les deux, c'est uniquement *comment* la ligne
 * a été retrouvée ; une fois retrouvée, la consommer est la même opération.
 *
 * `organizationId` dans le contexte suffit à satisfaire la policy de mise à
 * jour (`organization_id = app_current_organization_id()`), donc le jeton
 * n'a pas à reparaître ici — il ne servait déjà plus qu'à ça dans l'ancienne
 * version à un seul chemin.
 */
async function finalizeAcceptance(
  invitation: {
    id: string;
    organizationId: string;
    projectId: string | null;
    roleId: string;
  },
  userId: string,
): Promise<{ organizationId: string; projectId: string | null }> {
  return withContext(
    { userId, organizationId: invitation.organizationId },
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

      /**
       * L'adhésion peut avoir été créée entre l'envoi et le clic — ajoutée à
       * la main, ou par une autre invitation. `createInvitation` refuse déjà
       * d'inviter un membre, mais il ne peut rien contre cet intervalle : la
       * clé primaire est le seul juge sous concurrence.
       *
       * 23505 devient donc un refus lisible, jamais un 500.
       */
      const alreadyMember = (error: unknown) => {
        if ((error as { cause?: { code?: string } }).cause?.code === "23505") {
          throw new InvitationError(
            409,
            "already_member",
            "cette adresse est déjà membre",
          );
        }
        throw error;
      };

      if (invitation.projectId) {
        // Une invitation à un projet ne crée **jamais** d'adhésion à
        // l'organization (architecture/invitations.md).
        await tx
          .insert(projectMembers)
          .values({
            projectId: invitation.projectId,
            organizationId: invitation.organizationId,
            userId,
            roleId: invitation.roleId,
          })
          .catch(alreadyMember);
      } else {
        await tx
          .insert(organizationMembers)
          .values({
            organizationId: invitation.organizationId,
            userId,
            roleId: invitation.roleId,
          })
          .catch(alreadyMember);
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
