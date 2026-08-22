import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { auth } from "./auth.ts";
/**
 * ⚠️ **Import à effet de bord, et le seul du dépôt qui traverse la frontière.**
 *
 * Ce fichier est le point de composition : la seule place du socle autorisée à
 * savoir que `src/cms/` existe, et la règle de lint l'exempte nommément. Sans
 * cet import, le registre de permissions ne contiendrait pas le vocabulaire du
 * contenu, et **une organization neuve naîtrait avec des rôles amputés**
 * (ADR 0019).
 *
 * Le supprimer ne casse aucun typage. Ce qui l'attrape est le test de
 * `GET /api/permissions`, qui exige d'y voir `content.publish`.
 *
 * `cms/routes.ts` charge ce module par la chaîne d'imports, mais l'import
 * explicite reste : il dit ce qui doit être enregistré, plutôt que de le faire
 * dépendre d'un chemin d'import qui pourrait changer.
 */
import "./cms/permissions.ts";
import { cmsRoutes } from "./cms/routes.ts";
import { env } from "./config/env.ts";
import { managementRoutes } from "./http/routes.ts";
import { previewRoutes } from "./mail/preview.ts";
import { ServiceError } from "./services/service-error.ts";

export const app = new OpenAPIHono();

/**
 * Traitement centralisé des refus d'autorisation. Un refus est un événement
 * **normal** dans une application sécurisée ; le canaliser par un seul chemin
 * évite qu'un échec laisse l'application dans un état imprévisible
 * (CWE-280, ADR 0012).
 */
app.onError((error, c) => {
  // Un seul `instanceof` pour tous les refus métier. La version précédente
  // énumérait les classes et en avait déjà oublié une, ce qui transformait
  // chaque refus des clés API en 500 (services/service-error.ts).
  if (error instanceof ServiceError) {
    return c.json({ error: error.message, reason: error.reason }, error.status);
  }
  // Définir `onError` retire à Hono le traitement par défaut : les
  // HTTPException doivent être reconverties explicitement, sinon elles
  // remontent en 500.
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }
  console.error(error);
  return c.json({ error: "erreur interne" }, 500);
});

/**
 * Better-Auth sert toutes ses routes sous ce préfixe. Elles n'apparaissent pas
 * dans la spec OpenAPI : leur contrat appartient à Better-Auth, pas à nous.
 */
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

const healthResponseSchema = z
  .object({
    status: z.literal("ok"),
  })
  .openapi("HealthResponse");

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  summary: "Liveness probe",
  responses: {
    200: {
      description: "The server is running.",
      content: {
        "application/json": { schema: healthResponseSchema },
      },
    },
  },
});

app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }));

app.route("/api", managementRoutes);

// ⚠️ Sous le même préfixe, et c'est voulu : un client ne voit qu'une API. La
// séparation est une frontière de code, pas une frontière d'adresse.
app.route("/api", cmsRoutes);

// Prévisualisation des emails : jamais en production, elle expose la
// structure des gabarits sans raison.
if (env.NODE_ENV !== "production") {
  app.route("/dev/emails", previewRoutes);
}

app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "Skafform API",
    version: "0.0.0",
  },
});
