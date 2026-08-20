import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { requirePermission } from "../auth/escalation.ts";
import { auth } from "../auth.ts";
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  describeInvitation,
  listPendingInvitations,
} from "../services/invitations.ts";
import {
  createOrganization,
  createProject,
  listOrganizationsForUser,
  listProjects,
  listRoles,
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

const RoleSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    scope: z.enum(["organization", "project"]),
    isSystem: z.boolean(),
  })
  .openapi("Role");

/**
 * Les rôles assignables dans une organization.
 *
 * Gardée par `member.manage` et non `role.manage` : cette liste sert à
 * **attribuer** un rôle, pas à en définir un. Le garde-fou d'escalade s'exerce
 * de toute façon au moment de l'assignation — on peut voir un rôle plus
 * puissant que le sien sans pouvoir l'accorder (ADR 0011).
 */
managementRoutes.openapi(
  createRoute({
    method: "get",
    path: "/organizations/{organizationId}/roles",
    summary: "Les rôles d'une organization",
    middleware: [requireSession, requireOrganization] as const,
    request: { params: z.object({ organizationId: z.uuid() }) },
    responses: { 200: json(z.array(RoleSchema), "Liste") },
  }),
  async (c) => {
    const { organizationId } = c.req.valid("param");
    requirePermission(c.get("actor"), "member.manage");
    return c.json(await listRoles(c.get("userId"), organizationId));
  },
);

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

const InvitationInput = z
  .object({
    email: z.email(),
    roleId: z.uuid(),
    projectId: z.uuid().optional(),
  })
  .openapi("InvitationInput");

managementRoutes.openapi(
  createRoute({
    method: "get",
    path: "/organizations/{organizationId}/invitations",
    summary: "Les invitations en attente",
    middleware: [requireSession, requireOrganization] as const,
    request: { params: z.object({ organizationId: z.uuid() }) },
    responses: { 200: json(z.array(z.any()), "Liste") },
  }),
  async (c) => {
    const { organizationId } = c.req.valid("param");
    requirePermission(c.get("actor"), "member.manage");
    return c.json(await listPendingInvitations(c.get("userId"), organizationId));
  },
);

managementRoutes.openapi(
  createRoute({
    method: "post",
    path: "/organizations/{organizationId}/invitations",
    summary: "Inviter quelqu'un",
    middleware: [requireSession, requireOrganization] as const,
    request: {
      params: z.object({ organizationId: z.uuid() }),
      body: { content: { "application/json": { schema: InvitationInput } } },
    },
    responses: { 201: json(z.object({ id: z.uuid() }), "Envoyée") },
  }),
  async (c) => {
    const { organizationId } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = c.get("actor");

    // Le droit d'inviter dépend du rôle accordé, vérifié dans le service :
    // inviter, c'est accorder (ADR 0011).
    const [organization] = await listOrganizationsForUser(c.get("userId")).then(
      (list) => list.filter((o) => o.id === organizationId),
    );
    if (!organization) throw new HTTPException(404, { message: "introuvable" });

    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const { id } = await createInvitation({
      actor,
      invitedByName: session?.user.name ?? "Un membre",
      organizationId,
      organizationName: organization.name,
      email: body.email,
      roleId: body.roleId,
      ...(body.projectId ? { projectId: body.projectId } : {}),
    });
    return c.json({ id }, 201);
  },
);

managementRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/organizations/{organizationId}/invitations/{invitationId}",
    summary: "Annuler une invitation",
    middleware: [requireSession, requireOrganization] as const,
    request: {
      params: z.object({ organizationId: z.uuid(), invitationId: z.uuid() }),
    },
    responses: { 204: { description: "Annulée" } },
  }),
  async (c) => {
    const { organizationId, invitationId } = c.req.valid("param");
    requirePermission(c.get("actor"), "member.manage");
    await cancelInvitation({ actor: c.get("actor"), organizationId, invitationId });
    return c.body(null, 204);
  },
);

/**
 * Consulter une invitation depuis son jeton. **Sans session** : le
 * destinataire n'a pas encore de compte le plus souvent, et le jeton fait
 * office d'autorisation.
 */
managementRoutes.openapi(
  createRoute({
    method: "get",
    path: "/invitations/{token}",
    summary: "Décrire une invitation",
    request: { params: z.object({ token: z.string().min(1) }) },
    responses: { 200: json(z.any(), "Détail") },
  }),
  async (c) => c.json(await describeInvitation(c.req.valid("param").token)),
);

managementRoutes.openapi(
  createRoute({
    method: "post",
    path: "/invitations/{token}/accept",
    summary: "Accepter une invitation",
    middleware: [requireSession] as const,
    request: { params: z.object({ token: z.string().min(1) }) },
    responses: { 200: json(z.any(), "Acceptée") },
  }),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new HTTPException(401);
    return c.json(
      await acceptInvitation({
        token: c.req.valid("param").token,
        userId: session.user.id,
        userEmail: session.user.email,
      }),
    );
  },
);
