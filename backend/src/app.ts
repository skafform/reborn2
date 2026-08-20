import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { auth } from "./auth.ts";

export const app = new OpenAPIHono();

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

app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "Skafform API",
    version: "0.0.0",
  },
});
