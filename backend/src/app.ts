import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { AuthorizationError } from "./auth/escalation.ts";
import { auth } from "./auth.ts";
import { env } from "./config/env.ts";
import { managementRoutes } from "./http/routes.ts";
import { previewRoutes } from "./mail/preview.ts";
import { InvitationError } from "./services/invitations.ts";

export const app = new OpenAPIHono();

/**
 * Traitement centralisé des refus d'autorisation. Un refus est un événement
 * **normal** dans une application sécurisée ; le canaliser par un seul chemin
 * évite qu'un échec laisse l'application dans un état imprévisible
 * (CWE-280, ADR 0012).
 */
app.onError((error, c) => {
  if (error instanceof AuthorizationError || error instanceof InvitationError) {
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
