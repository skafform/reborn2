import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { type Actor, resolveActor } from "../auth/authorization.ts";
import { auth } from "../auth.ts";

/**
 * Point de passage obligé de toute requête authentifiée : il résout l'acteur,
 * charge ses permissions en une requête, et refuse ce qui ne le concerne pas.
 *
 * Voir ADR 0012.
 */

export type Variables = {
  userId: string;
  actor: Actor;
};

/** Résout la session Better-Auth. 401 si absente — rien à cacher ici. */
export const requireSession = createMiddleware<{ Variables: Variables }>(
  async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      throw new HTTPException(401, { message: "authentification requise" });
    }
    c.set("userId", session.user.id);
    await next();
  },
);

/**
 * Résout l'acteur dans l'organization visée par la route.
 *
 * **404 et non 403** lorsque l'acteur n'y a aucun accès : un 403 confirmerait
 * l'existence de l'organization, ce qui offre son énumération. Le 403 est
 * réservé aux cas où la ressource est visible mais l'action interdite —
 * là, il n'y a plus rien à cacher (ADR 0012).
 *
 * Cela s'aligne avec RLS, qui renvoie déjà zéro ligne pour une ressource
 * invisible : la base et l'API disent la même chose par construction.
 */
export const requireOrganization = createMiddleware<{ Variables: Variables }>(
  async (c, next) => {
    const organizationId = c.req.param("organizationId");
    if (!organizationId) {
      throw new HTTPException(404, { message: "introuvable" });
    }

    const actor = await resolveActor(c.get("userId"), organizationId);
    if (!actor.grant) {
      throw new HTTPException(404, { message: "introuvable" });
    }

    c.set("actor", actor);
    await next();
  },
);
