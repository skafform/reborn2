import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { heldPermissions } from "../auth/authorization.ts";
import { canAssignRole, requirePermission } from "../auth/escalation.ts";
import { auth } from "../auth.ts";
import {
  acceptInvitation,
  acceptReceivedInvitation,
  cancelInvitation,
  createInvitation,
  describeInvitation,
  listPendingInvitations,
  listReceivedInvitations,
} from "../services/invitations.ts";
import {
  createOrganization,
  createProject,
  listMembers,
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

/**
 * Ce que l'acteur peut faire dans cette organization.
 *
 * L'interface a besoin de le savoir pour ne pas proposer une porte fermée.
 * Le **nom du rôle ne suffit pas** : les rôles sont personnalisables par
 * organization (ADR 0011), donc « viewer » ne garantit rien — et déduire les
 * permissions d'un nom côté client recopierait la matrice RBAC hors de son
 * unique source de vérité.
 *
 * ⚠️ Masquer une entrée d'interface est un **confort, jamais le garde-fou** :
 * chaque route reste gardée par `can()`, seule autorité.
 */
managementRoutes.openapi(
  createRoute({
    method: "get",
    path: "/organizations/{organizationId}/me",
    summary: "Le rôle et les permissions de l'acteur",
    middleware: [requireSession, requireOrganization] as const,
    request: { params: z.object({ organizationId: z.uuid() }) },
    responses: {
      200: json(
        z.object({ permissions: z.array(z.string()) }).openapi("CurrentMembership"),
        "Permissions",
      ),
    },
  }),
  (c) => c.json({ permissions: [...heldPermissions(c.get("actor"))] }),
);

const MemberSchema = z
  .object({
    userId: z.string(),
    roleId: z.uuid(),
    roleName: z.string(),
    name: z.string(),
    email: z.email(),
    joinedAt: z.date(),
  })
  .openapi("Member");

/**
 * Les membres d'une organization.
 *
 * Gardée par `member.read` et non `member.manage` : voir l'équipe et pouvoir
 * la modifier sont deux choses. Un `viewer` — « un admin sans écriture » — a
 * la première, pas la seconde. Les rôles de projet (`guest`, `contributor`,
 * `editor`) n'ont ni l'une ni l'autre : un pigiste n'a pas à voir l'annuaire
 * de l'organization.
 *
 * `member.read` s'arrête à l'annuaire : les invitations en attente relèvent du
 * recrutement, donc de `member.manage`.
 */
managementRoutes.openapi(
  createRoute({
    method: "get",
    path: "/organizations/{organizationId}/members",
    summary: "Les membres d'une organization",
    middleware: [requireSession, requireOrganization] as const,
    request: { params: z.object({ organizationId: z.uuid() }) },
    responses: { 200: json(z.array(MemberSchema), "Liste") },
  }),
  async (c) => {
    const { organizationId } = c.req.valid("param");
    requirePermission(c.get("actor"), "member.read");
    return c.json(await listMembers(c.get("userId"), organizationId));
  },
);

const RoleSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    scope: z.enum(["organization", "project"]),
    isSystem: z.boolean(),
    /**
     * L'appelant peut-il assigner ce rôle ? Calculé par `canAssignRole`, le
     * **même** garde-fou qui refuserait ensuite — pas une seconde règle.
     *
     * Seul le verdict sort d'ici : les permissions de chaque rôle restent
     * côté serveur. Les exposer laisserait la porte ouverte à ce qu'un client
     * réimplémente la règle d'escalade, qui doit vivre à un seul endroit.
     */
    assignable: z.boolean(),
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
    const actor = c.get("actor");
    requirePermission(actor, "member.manage");

    const roles = await listRoles(c.get("userId"), organizationId);
    return c.json(
      roles.map(({ permissions, ...role }) => ({
        ...role,
        assignable: canAssignRole(actor, { ...role, permissions }),
      })),
    );
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

const PendingInvitationSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    roleName: z.string(),
    /** `null` pour une invitation d'organization, renseigné pour un projet. */
    projectId: z.uuid().nullable(),
    expiresAt: z.date(),
  })
  .openapi("PendingInvitation");

/**
 * Ce que l'acceptation crée. Une invitation de projet ne produit **aucune**
 * adhésion à l'organization : `projectId` est alors renseigné, et l'appelant
 * doit en tenir compte pour savoir où aller ensuite.
 */
const AcceptedInvitationSchema = z
  .object({
    organizationId: z.uuid(),
    projectId: z.uuid().nullable(),
  })
  .openapi("AcceptedInvitation");

managementRoutes.openapi(
  createRoute({
    method: "get",
    path: "/organizations/{organizationId}/invitations",
    summary: "Les invitations en attente",
    middleware: [requireSession, requireOrganization] as const,
    request: { params: z.object({ organizationId: z.uuid() }) },
    responses: { 200: json(z.array(PendingInvitationSchema), "Liste") },
  }),
  async (c) => {
    const { organizationId } = c.req.valid("param");
    // `member.manage`, pas `member.read` : une invitation en attente relève du
    // recrutement, pas de l'annuaire. Un `viewer` voit qui est dans l'équipe,
    // pas qui est en train d'y être admis.
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

const InvitationDescriptionSchema = z
  .object({
    email: z.email(),
    organizationName: z.string(),
    roleName: z.string(),
    /**
     * L'adresse visée a-t-elle déjà un compte ? L'écran d'acceptation propose
     * alors *soit* la connexion, *soit* l'inscription — plutôt que les deux,
     * en laissant deviner. Gardé par le jeton, donc sans énumération possible
     * (voir `describeInvitation`).
     */
    hasAccount: z.boolean(),
  })
  .openapi("InvitationDescription");

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
    responses: { 200: json(InvitationDescriptionSchema, "Détail") },
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
    responses: { 200: json(AcceptedInvitationSchema, "Acceptée") },
  }),
  async (c) =>
    c.json(
      await acceptInvitation({
        token: c.req.valid("param").token,
        userId: c.get("userId"),
        userEmail: c.get("userEmail"),
      }),
    ),
);

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

const ReceivedInvitationSchema = z
  .object({
    id: z.uuid(),
    organizationName: z.string(),
    roleName: z.string(),
    expiresAt: z.date(),
  })
  .openapi("ReceivedInvitation");

/**
 * Les invitations en attente adressées à la session vérifiée, tous
 * locataires confondus — jamais un `organizationId` en paramètre, cette
 * route existe justement pour qui n'en a encore aucune.
 */
managementRoutes.openapi(
  createRoute({
    method: "get",
    path: "/inbox",
    summary: "Les invitations reçues",
    middleware: [requireSession] as const,
    responses: { 200: json(z.array(ReceivedInvitationSchema), "Liste") },
  }),
  async (c) =>
    c.json(await listReceivedInvitations(c.get("userId"), c.get("userEmail"))),
);

managementRoutes.openapi(
  createRoute({
    method: "post",
    path: "/inbox/{invitationId}/accept",
    summary: "Accepter une invitation reçue",
    middleware: [requireSession] as const,
    request: { params: z.object({ invitationId: z.uuid() }) },
    responses: { 200: json(AcceptedInvitationSchema, "Acceptée") },
  }),
  async (c) =>
    c.json(
      await acceptReceivedInvitation({
        invitationId: c.req.valid("param").invitationId,
        userId: c.get("userId"),
        userEmail: c.get("userEmail"),
      }),
    ),
);
