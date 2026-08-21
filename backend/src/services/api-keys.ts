import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import type { Actor, KeyActor } from "../auth/authorization.ts";
import { requirePermission } from "../auth/escalation.ts";
import { API_KEY_TOKEN_BYTES } from "../config/constants.ts";
import type { Permission } from "../config/permissions.ts";
import { withContext } from "../db/client.ts";
import { apiKeys, environments, projects } from "../db/schema.ts";
import { ServiceError } from "./service-error.ts";

/**
 * Clés d'accès machine. Rattachées à un environnement (ADR 0013).
 *
 * Leurs capacités sont exprimées dans le **même catalogue de permissions** que
 * les rôles humains, ce qui évite un second système d'autorisation et se
 * referme sur l'acteur polymorphe du journal d'audit (ADR 0004).
 */

export type ApiKeyKind = "public" | "preview" | "secret";

export const API_KEY_PERMISSIONS: Record<ApiKeyKind, readonly Permission[]> = {
  /** Sites consommateurs : contenu publié seulement. */
  public: ["content.read", "schema.read"],
  /** Prévisualisation : y compris les brouillons. */
  preview: ["content.read", "content.read_draft", "schema.read"],
  /** Scripts de migration : lecture, écriture, publication et schémas. */
  secret: [
    "content.read",
    "content.read_draft",
    "content.write",
    "content.publish",
    "schema.read",
    "schema.write",
  ],
};

const PREFIX: Record<ApiKeyKind, string> = {
  public: "pk_",
  preview: "pv_",
  secret: "sk_",
};

export class ApiKeyError extends ServiceError {
  declare readonly status: 404 | 409;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Crée une clé.
 *
 * Le jeton clair n'est renvoyé qu'ici. Pour les types publique et preview il
 * reste consultable ensuite ; pour le type **secret**, c'est la seule et
 * unique fois — seul son hachage est conservé.
 */
export async function createApiKey(input: {
  actor: Actor;
  organizationId: string;
  environmentId: string;
  kind: ApiKeyKind;
  name: string;
}): Promise<{ id: string; token: string }> {
  requirePermission(input.actor, "apikey.manage");

  const token = `${PREFIX[input.kind]}${randomBytes(API_KEY_TOKEN_BYTES).toString("base64url")}`;
  const secret = input.kind === "secret";

  const id = await withContext(
    { userId: input.actor.userId, organizationId: input.organizationId },
    async (tx) => {
      const [created] = await tx
        .insert(apiKeys)
        .values({
          environmentId: input.environmentId,
          organizationId: input.organizationId,
          kind: input.kind,
          name: input.name,
          token: secret ? null : token,
          tokenHash: secret ? hashToken(token) : null,
          hint: `${token.slice(0, PREFIX[input.kind].length + 4)}…`,
        })
        .returning({ id: apiKeys.id });

      if (!created) {
        throw new ApiKeyError(
          404,
          "unknown_environment",
          "environnement introuvable dans cette organization",
        );
      }
      return created.id;
    },
  );

  return { id, token };
}

/**
 * Liste les clés d'un environnement. Le jeton en clair n'apparaît que pour les
 * types publique et preview ; une clé secrète ne montre que son préfixe.
 */
export function listApiKeys(
  actor: Actor,
  organizationId: string,
  environmentId: string,
) {
  requirePermission(actor, "apikey.manage");
  return withContext({ userId: actor.userId, organizationId }, (tx) =>
    tx
      .select({
        id: apiKeys.id,
        kind: apiKeys.kind,
        name: apiKeys.name,
        token: apiKeys.token,
        hint: apiKeys.hint,
        revokedAt: apiKeys.revokedAt,
        // `last_used_at` n'est pas sélectionné : **rien ne l'écrit** tant
        // qu'aucune route ne s'authentifie par clé (étape 7). Le renvoyer
        // ferait apparaître dans la spec un champ qui ne peut dire qu'une
        // seule chose, et que l'écran devrait ignorer.
      })
      .from(apiKeys)
      .where(eq(apiKeys.environmentId, environmentId)),
  );
}

/** Révoque une clé : elle cesse de fonctionner, son enregistrement subsiste. */
export async function revokeApiKey(input: {
  actor: Actor;
  organizationId: string;
  apiKeyId: string;
}): Promise<void> {
  requirePermission(input.actor, "apikey.manage");

  await withContext(
    { userId: input.actor.userId, organizationId: input.organizationId },
    async (tx) => {
      const revoked = await tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, input.apiKeyId), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id });

      if (revoked.length === 0) {
        throw new ApiKeyError(
          404,
          "not_active",
          "aucune clé active pour cet identifiant",
        );
      }
    },
  );
}

/**
 * Supprime une clé **déjà révoquée**.
 *
 * Supprimer une clé encore active est interdit : on ne saurait plus si elle
 * était en circulation, et le journal d'audit perdrait sa référence
 * (architecture/api.md).
 */
export async function deleteApiKey(input: {
  actor: Actor;
  organizationId: string;
  apiKeyId: string;
}): Promise<void> {
  requirePermission(input.actor, "apikey.manage");

  await withContext(
    { userId: input.actor.userId, organizationId: input.organizationId },
    async (tx) => {
      const [existing] = await tx
        .select({ revokedAt: apiKeys.revokedAt })
        .from(apiKeys)
        .where(eq(apiKeys.id, input.apiKeyId));

      if (!existing) {
        throw new ApiKeyError(404, "unknown_key", "clé introuvable");
      }
      if (!existing.revokedAt) {
        throw new ApiKeyError(
          409,
          "not_revoked",
          "révoquer la clé avant de la supprimer",
        );
      }

      await tx.delete(apiKeys).where(eq(apiKeys.id, input.apiKeyId));
    },
  );
}

/** L'environnement `master` d'un projet, seul existant pour l'instant. */
export function masterEnvironment(
  userId: string,
  organizationId: string,
  projectId: string,
) {
  return withContext({ userId, organizationId }, async (tx) => {
    const [environment] = await tx
      .select({ id: environments.id })
      .from(environments)
      .innerJoin(projects, eq(projects.id, environments.projectId))
      .where(
        and(
          eq(environments.projectId, projectId),
          eq(environments.name, "master"),
          eq(projects.organizationId, organizationId),
        ),
      );
    if (!environment) {
      throw new ApiKeyError(404, "unknown_project", "projet introuvable");
    }
    return environment.id;
  });
}

/**
 * Résout une clé présentée par un client en acteur machine.
 *
 * La recherche est faite **sans contexte d'organization** : au moment où une
 * clé arrive, on ne sait pas encore de quel locataire il s'agit — c'est
 * justement ce qu'elle détermine. La clé est donc son propre laissez-passer,
 * comme le jeton d'invitation, et la policy correspondante l'exprime.
 *
 * Une clé révoquée ne résout rien.
 */
export async function resolveApiKey(presented: string): Promise<KeyActor | null> {
  const hashed = hashToken(presented);

  return withContext(
    { apiKeyToken: presented, apiKeyTokenHash: hashed },
    async (tx) => {
      const [row] = await tx
        .select({
          id: apiKeys.id,
          kind: apiKeys.kind,
          environmentId: apiKeys.environmentId,
          // Aucune jointure : la clé porte son `organization_id`. Traverser
          // `environments` recréerait le cycle de policies que cette
          // dénormalisation a précisément rompu (migration 0018).
          organizationId: apiKeys.organizationId,
          revokedAt: apiKeys.revokedAt,
        })
        .from(apiKeys)
        .where(or(eq(apiKeys.token, presented), eq(apiKeys.tokenHash, hashed)));

      if (!row || row.revokedAt) return null;

      return {
        apiKeyId: row.id,
        environmentId: row.environmentId,
        organizationId: row.organizationId,
        permissions: new Set(API_KEY_PERMISSIONS[row.kind]),
      };
    },
  );
}
