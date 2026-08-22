import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  requireOrganization,
  requireSession,
  type Variables,
} from "../http/middleware.ts";
import { masterEnvironment } from "../services/api-keys.ts";
import { DefinitionSchema } from "./definition.ts";
import {
  createLibrarySchema,
  deleteLibrarySchema,
  listLibrarySchemaHistory,
  listLibrarySchemas,
  restoreLibrarySchemaVersion,
  updateLibrarySchema,
} from "./library.ts";
import { HISTORY_ACTIONS } from "./schema.ts";
import {
  copyFromLibrary,
  createSchema,
  deleteSchema,
  listSchemaHistory,
  listSchemas,
  ORIGIN_STATES,
  restoreSchemaVersion,
  updateSchema,
} from "./schemas.ts";

/**
 * Les routes du CMS, montées par `app.ts` sous le même préfixe que celles du
 * socle.
 *
 * ⚠️ **Une sous-application distincte**, pas des routes ajoutées à
 * `managementRoutes`. C'est la même frontière que partout : le socle ne
 * connaît pas ces routes, il monte ce que le point de composition lui donne
 * (ADR 0019).
 *
 * ⚠️ **L'environnement est résolu ici, pas demandé.** Le chemin nomme un
 * projet ; `master` en est déduit, et le mot « environnement » n'apparaît
 * jamais dans l'API tant que la fonctionnalité n'existe pas
 * (architecture/environments.md).
 */
export const cmsRoutes = new OpenAPIHono<{ Variables: Variables }>();

const projectParams = z.object({ organizationId: z.uuid(), projectId: z.uuid() });
const schemaParams = projectParams.extend({ schemaId: z.uuid() });

const SchemaSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    label: z.string().nullable(),
    definition: DefinitionSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .openapi("Schema");

/**
 * D'où vient ce type de contenu, et où il en est par rapport à sa source.
 *
 * ⚠️ **`locally_modified` confond « seule la copie a bougé » et « les deux ont
 * bougé »** (ADR 0018). Le nom est choisi pour qu'aucun écran ne le survende —
 * il ne dit pas *qui* a divergé, seulement que la copie n'est plus un état
 * connu de la bibliothèque.
 */
const OriginSchema = z
  .object({
    librarySchemaId: z.uuid(),
    /** Le nom **côté bibliothèque**, qui peut différer de celui de la copie. */
    name: z.string(),
    state: z.enum(ORIGIN_STATES),
  })
  .openapi("SchemaOrigin");

/** Un type de contenu tel que la liste le rend : avec sa provenance. */
const ListedSchemaSchema = SchemaSchema.extend({
  origin: OriginSchema.nullable(),
}).openapi("ListedSchema");

/**
 * ⚠️ **`name` est l'identifiant du type de contenu**, contraint comme celui
 * d'un champ : il finira dans une adresse d'API de livraison et dans des types
 * générés. `label` est ce qu'on renomme.
 */
const SchemaInput = z
  .object({
    name: z
      .string()
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
      .max(64),
    label: z.string().min(1).max(200).nullable(),
    definition: DefinitionSchema,
  })
  .openapi("SchemaInput");

/**
 * ⚠️ **La forme d'une empreinte, sans nommer l'algorithme courant.** Un
 * `sha256-1` gravé dans le contrat obligerait à le republier le jour du
 * changement de tag — or ce tag existe précisément pour pouvoir changer
 * ([ADR 0016](../../../docs/adr/0016-versionnage-des-schemas-adresse-par-contenu.md)).
 * La borne dit « un tag, puis un condensé hexadécimal », et pas lequel.
 */
const HashSchema = z
  .string()
  .regex(/^[a-z0-9-]+:[0-9a-f]{64}$/)
  .openapi({
    example:
      "sha256-1:eed07419c964a6936ee1ff00ce0a7834ce1dc7730547c2150ab6fc99d5109441",
  });

const HistoryEntrySchema = z
  .object({
    hash: HashSchema,
    action: z.enum(HISTORY_ACTIONS),
    createdAt: z.date(),
    /**
     * ⚠️ **`null` quand le compte a été supprimé**, pas quand personne n'a
     * agi : `actor_user_id` est en `ON DELETE SET NULL`, l'histoire survivant
     * aux comptes. L'écran doit le dire, sinon ça ressemble à un défaut.
     */
    actorName: z.string().nullable(),
    actorEmail: z.string().nullable(),
    /** L'état que cette entrée a nommé — le journal se lit sans le déplier. */
    name: z.string(),
    label: z.string().nullable(),
  })
  .openapi("SchemaHistoryEntry");

const HistorySchema = z
  .object({
    /** Où le pointeur se trouve — sans quoi l'écran proposerait de restaurer
     * l'état déjà courant. */
    currentHash: HashSchema,
    entries: z.array(HistoryEntrySchema),
  })
  .openapi("SchemaHistory");

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

cmsRoutes.openapi(
  createRoute({
    method: "get",
    path: "/organizations/{organizationId}/projects/{projectId}/schemas",
    summary: "Les types de contenu d'un projet",
    middleware: [requireSession, requireOrganization] as const,
    request: { params: projectParams },
    responses: { 200: json(z.array(ListedSchemaSchema), "Liste") },
  }),
  async (c) => {
    const { organizationId, projectId } = c.req.valid("param");
    const environmentId = await masterEnvironment(
      c.get("userId"),
      organizationId,
      projectId,
    );
    return c.json(await listSchemas(c.get("actor"), organizationId, environmentId));
  },
);

cmsRoutes.openapi(
  createRoute({
    method: "post",
    path: "/organizations/{organizationId}/projects/{projectId}/schemas",
    summary: "Créer un type de contenu",
    middleware: [requireSession, requireOrganization] as const,
    request: {
      params: projectParams,
      body: { content: { "application/json": { schema: SchemaInput } } },
    },
    responses: { 201: json(SchemaSchema, "Créé") },
  }),
  async (c) => {
    const { organizationId, projectId } = c.req.valid("param");
    const environmentId = await masterEnvironment(
      c.get("userId"),
      organizationId,
      projectId,
    );
    const created = await createSchema({
      actor: c.get("actor"),
      organizationId,
      environmentId,
      fields: c.req.valid("json"),
    });
    return c.json(created, 201);
  },
);

cmsRoutes.openapi(
  createRoute({
    method: "put",
    path: "/organizations/{organizationId}/projects/{projectId}/schemas/{schemaId}",
    summary: "Modifier un type de contenu",
    middleware: [requireSession, requireOrganization] as const,
    request: {
      params: schemaParams,
      body: { content: { "application/json": { schema: SchemaInput } } },
    },
    responses: { 200: json(SchemaSchema, "Modifié") },
  }),
  async (c) => {
    const { organizationId, projectId, schemaId } = c.req.valid("param");
    const environmentId = await masterEnvironment(
      c.get("userId"),
      organizationId,
      projectId,
    );
    return c.json(
      await updateSchema({
        actor: c.get("actor"),
        organizationId,
        environmentId,
        schemaId,
        fields: c.req.valid("json"),
      }),
    );
  },
);

cmsRoutes.openapi(
  createRoute({
    method: "get",
    path: "/organizations/{organizationId}/projects/{projectId}/schemas/{schemaId}/history",
    summary: "La lignée d'un type de contenu",
    // Lire une lignée est une lecture de schéma : aucune permission nouvelle.
    middleware: [requireSession, requireOrganization] as const,
    request: { params: schemaParams },
    responses: { 200: json(HistorySchema, "Du plus récent au plus ancien") },
  }),
  async (c) => {
    const { organizationId, projectId, schemaId } = c.req.valid("param");
    const environmentId = await masterEnvironment(
      c.get("userId"),
      organizationId,
      projectId,
    );
    return c.json(
      await listSchemaHistory({
        actor: c.get("actor"),
        organizationId,
        environmentId,
        schemaId,
      }),
    );
  },
);

cmsRoutes.openapi(
  createRoute({
    method: "post",
    path: "/organizations/{organizationId}/projects/{projectId}/schemas/{schemaId}/restore",
    summary: "Restaurer une version antérieure",
    // Restaurer est une écriture de schéma : aucune permission nouvelle non plus.
    middleware: [requireSession, requireOrganization] as const,
    request: {
      params: schemaParams,
      body: {
        content: {
          "application/json": {
            schema: z.object({ hash: HashSchema }).openapi("SchemaRestoreInput"),
          },
        },
      },
    },
    responses: { 200: json(SchemaSchema, "Restauré") },
  }),
  async (c) => {
    const { organizationId, projectId, schemaId } = c.req.valid("param");
    const environmentId = await masterEnvironment(
      c.get("userId"),
      organizationId,
      projectId,
    );
    return c.json(
      await restoreSchemaVersion({
        actor: c.get("actor"),
        organizationId,
        environmentId,
        schemaId,
        hash: c.req.valid("json").hash,
      }),
    );
  },
);

cmsRoutes.openapi(
  createRoute({
    method: "post",
    path: "/organizations/{organizationId}/projects/{projectId}/schemas/copy",
    summary: "Copier un schéma de la bibliothèque dans ce projet",
    // ⚠️ Aucune permission nouvelle : copier crée un type de contenu, donc
    // `schema.write`, et lire la bibliothèque est `schema.read`. Le service
    // exige les deux.
    middleware: [requireSession, requireOrganization] as const,
    request: {
      params: projectParams,
      body: {
        content: {
          "application/json": {
            schema: z.object({ librarySchemaId: z.uuid() }).openapi("SchemaCopyInput"),
          },
        },
      },
    },
    responses: { 201: json(SchemaSchema, "Copié") },
  }),
  async (c) => {
    const { organizationId, projectId } = c.req.valid("param");
    const environmentId = await masterEnvironment(
      c.get("userId"),
      organizationId,
      projectId,
    );
    const created = await copyFromLibrary({
      actor: c.get("actor"),
      organizationId,
      environmentId,
      librarySchemaId: c.req.valid("json").librarySchemaId,
    });
    return c.json(created, 201);
  },
);

cmsRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/organizations/{organizationId}/projects/{projectId}/schemas/{schemaId}",
    summary: "Supprimer un type de contenu",
    middleware: [requireSession, requireOrganization] as const,
    request: { params: schemaParams },
    responses: { 204: { description: "Supprimé" } },
  }),
  async (c) => {
    const { organizationId, projectId, schemaId } = c.req.valid("param");
    const environmentId = await masterEnvironment(
      c.get("userId"),
      organizationId,
      projectId,
    );
    await deleteSchema({
      actor: c.get("actor"),
      organizationId,
      environmentId,
      schemaId,
    });
    return c.body(null, 204);
  },
);

/**
 * La bibliothèque de schémas de l'organization
 * ([ADR 0018](../../../docs/adr/0018-bibliotheque-de-schemas-table-separee.md)).
 *
 * ⚠️ **Aucun projet dans le chemin, et aucun environnement.** Une entrée de
 * bibliothèque appartient à l'organization seule — c'est ce qui la distingue
 * d'un type de contenu, et l'adresse doit le dire.
 */
const organizationParams = z.object({ organizationId: z.uuid() });
const libraryParams = organizationParams.extend({ librarySchemaId: z.uuid() });

const LibrarySchemaSchema = SchemaSchema.extend({
  /** Le courant voyage avec la ligne : c'est lui qu'une copie comparera. */
  currentHash: HashSchema,
}).openapi("LibrarySchema");

cmsRoutes.openapi(
  createRoute({
    method: "get",
    path: "/organizations/{organizationId}/library",
    summary: "Les schémas de la bibliothèque",
    middleware: [requireSession, requireOrganization] as const,
    request: { params: organizationParams },
    responses: { 200: json(z.array(LibrarySchemaSchema), "Liste") },
  }),
  async (c) => {
    const { organizationId } = c.req.valid("param");
    return c.json(await listLibrarySchemas(c.get("actor"), organizationId));
  },
);

cmsRoutes.openapi(
  createRoute({
    method: "post",
    path: "/organizations/{organizationId}/library",
    summary: "Ajouter un schéma à la bibliothèque",
    middleware: [requireSession, requireOrganization] as const,
    request: {
      params: organizationParams,
      body: { content: { "application/json": { schema: SchemaInput } } },
    },
    responses: { 201: json(SchemaSchema, "Créé") },
  }),
  async (c) => {
    const { organizationId } = c.req.valid("param");
    const created = await createLibrarySchema({
      actor: c.get("actor"),
      organizationId,
      fields: c.req.valid("json"),
    });
    return c.json(created, 201);
  },
);

cmsRoutes.openapi(
  createRoute({
    method: "put",
    path: "/organizations/{organizationId}/library/{librarySchemaId}",
    summary: "Modifier un schéma de la bibliothèque",
    middleware: [requireSession, requireOrganization] as const,
    request: {
      params: libraryParams,
      body: { content: { "application/json": { schema: SchemaInput } } },
    },
    responses: { 200: json(SchemaSchema, "Modifié") },
  }),
  async (c) => {
    const { organizationId, librarySchemaId } = c.req.valid("param");
    return c.json(
      await updateLibrarySchema({
        actor: c.get("actor"),
        organizationId,
        librarySchemaId,
        fields: c.req.valid("json"),
      }),
    );
  },
);

cmsRoutes.openapi(
  createRoute({
    method: "get",
    path: "/organizations/{organizationId}/library/{librarySchemaId}/history",
    summary: "La lignée d'un schéma de bibliothèque",
    middleware: [requireSession, requireOrganization] as const,
    request: { params: libraryParams },
    responses: { 200: json(HistorySchema, "Du plus récent au plus ancien") },
  }),
  async (c) => {
    const { organizationId, librarySchemaId } = c.req.valid("param");
    return c.json(
      await listLibrarySchemaHistory({
        actor: c.get("actor"),
        organizationId,
        librarySchemaId,
      }),
    );
  },
);

cmsRoutes.openapi(
  createRoute({
    method: "post",
    path: "/organizations/{organizationId}/library/{librarySchemaId}/restore",
    summary: "Restaurer une version antérieure d'un schéma de bibliothèque",
    middleware: [requireSession, requireOrganization] as const,
    request: {
      params: libraryParams,
      body: {
        content: {
          "application/json": {
            schema: z.object({ hash: HashSchema }).openapi("LibraryRestoreInput"),
          },
        },
      },
    },
    responses: { 200: json(SchemaSchema, "Restauré") },
  }),
  async (c) => {
    const { organizationId, librarySchemaId } = c.req.valid("param");
    return c.json(
      await restoreLibrarySchemaVersion({
        actor: c.get("actor"),
        organizationId,
        librarySchemaId,
        hash: c.req.valid("json").hash,
      }),
    );
  },
);

cmsRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/organizations/{organizationId}/library/{librarySchemaId}",
    summary: "Retirer un schéma de la bibliothèque",
    middleware: [requireSession, requireOrganization] as const,
    request: { params: libraryParams },
    responses: { 204: { description: "Retiré" } },
  }),
  async (c) => {
    const { organizationId, librarySchemaId } = c.req.valid("param");
    await deleteLibrarySchema({
      actor: c.get("actor"),
      organizationId,
      librarySchemaId,
    });
    return c.body(null, 204);
  },
);
