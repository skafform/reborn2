import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { requirePermission } from "../auth/escalation.ts";
import {
  createOrganization,
  createProject,
  listOrganizationsForUser,
  listProjects,
} from "../services/organizations.ts";
import { requireOrganization, requireSession, type Variables } from "./middleware.ts";

/**
 * Routes de gestion. Chacune passe par `requireSession`, et celles qui visent
 * une organization par `requireOrganization` — qui répond 404 plutôt que 403
 * quand l'acteur n'y a aucun accès (ADR 0012).
 */
export const managementRoutes = new OpenAPIHono<{ Variables: Variables }>();

const OrganizationSchema = z
  .object({ id: z.uuid(), name: z.string() })
  .openapi("Organization");

const ProjectSchema = z.object({ id: z.uuid(), name: z.string() }).openapi("Project");

const NameInput = z.object({ name: z.string().min(1).max(200) }).openapi("NameInput");

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

managementRoutes.openapi(
  createRoute({
    method: "get",
    path: "/organizations",
    summary: "Les organizations de l'utilisateur",
    middleware: [requireSession] as const,
    responses: {
      200: json(z.array(OrganizationSchema.extend({ role: z.string() })), "Liste"),
    },
  }),
  async (c) => c.json(await listOrganizationsForUser(c.get("userId"))),
);

managementRoutes.openapi(
  createRoute({
    method: "post",
    path: "/organizations",
    summary: "Créer une organization",
    middleware: [requireSession] as const,
    request: { body: { content: { "application/json": { schema: NameInput } } } },
    responses: { 201: json(OrganizationSchema, "Créée") },
  }),
  async (c) => {
    const { name } = c.req.valid("json");
    // Aucune permission requise : tout utilisateur inscrit peut créer une
    // organization, et en devient `owner` (architecture/multi-tenant.md).
    const organization = await createOrganization({
      userId: c.get("userId"),
      name,
    });
    return c.json(organization, 201);
  },
);

managementRoutes.openapi(
  createRoute({
    method: "get",
    path: "/organizations/{organizationId}/projects",
    summary: "Les projets d'une organization",
    middleware: [requireSession, requireOrganization] as const,
    request: { params: z.object({ organizationId: z.uuid() }) },
    responses: { 200: json(z.array(ProjectSchema), "Liste") },
  }),
  async (c) => {
    const { organizationId } = c.req.valid("param");
    requirePermission(c.get("actor"), "content.read");
    return c.json(await listProjects(c.get("userId"), organizationId));
  },
);

managementRoutes.openapi(
  createRoute({
    method: "post",
    path: "/organizations/{organizationId}/projects",
    summary: "Créer un projet",
    middleware: [requireSession, requireOrganization] as const,
    request: {
      params: z.object({ organizationId: z.uuid() }),
      body: { content: { "application/json": { schema: NameInput } } },
    },
    responses: { 201: json(ProjectSchema, "Créé") },
  }),
  async (c) => {
    const { organizationId } = c.req.valid("param");
    const { name } = c.req.valid("json");
    requirePermission(c.get("actor"), "project.create");
    const project = await createProject({
      userId: c.get("userId"),
      organizationId,
      name,
    });
    return c.json(project, 201);
  },
);
