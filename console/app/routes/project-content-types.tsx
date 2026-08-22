import { useEffect, useState } from "react";
import {
  Form,
  Link,
  useLocation,
  useNavigate,
  useNavigation,
  useOutletContext,
} from "react-router";
import { api, apiVoid, displayableError, postJson } from "../lib/api";
import {
  type ContentType,
  ContentTypeHistorySchema,
  ContentTypesSchema,
  CopiedContentTypeSchema,
  CopyFromLibrarySchema,
  CreatedContentTypeSchema,
  LibrarySchemasSchema,
  NewContentTypeSchema,
  RestoreContentTypeSchema,
  RestoredContentTypeSchema,
} from "../lib/api-contract";
import { contentTypeBody } from "../lib/content-type-body";
import { day } from "../lib/format";
import {
  Banner,
  Button,
  Empty,
  HeaderAction,
  Modal,
  RowAction,
  Section,
} from "../ui/controls";
import { Lineage } from "../ui/lineage";
import { SchemaFields } from "../ui/schema-fields";
import type { Route } from "./+types/project-content-types";
import type { ProjectContext } from "./project";

/**
 * Les types de contenu d'un projet, et la lignée de chacun.
 *
 * ⚠️ **Le mot « environnement » n'apparaît pas**, ici comme dans l'API : le
 * chemin nomme un projet, et `master` est résolu côté serveur
 * (architecture/environments.md).
 *
 * ⚠️ **La lignée ouverte est un paramètre d'URL**, pas un état de composant.
 * L'ouvrir est une navigation, donc React Router recharge le chargeur et la
 * restauration passe par le même `clientAction` que le reste — pas de second
 * mécanisme de récupération à côté du premier. Et l'écran devient adressable.
 */
export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  const base = `/organizations/${params.organizationId}/projects/${params.projectId}/schemas`;
  const opened = new URL(request.url).searchParams.get("history");

  const [contentTypes, library, history] = await Promise.all([
    api(base, ContentTypesSchema),
    // La bibliothèque est chargée d'emblée : le bouton doit savoir s'il y a
    // quelque chose à copier avant qu'on clique.
    api(`/organizations/${params.organizationId}/library`, LibrarySchemasSchema),
    opened ? api(`${base}/${opened}/history`, ContentTypeHistorySchema) : null,
  ]);

  return {
    contentTypes,
    library,
    history: opened && history ? { schemaId: opened, ...history } : null,
  };
}

export async function clientAction({ params, request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const base = `/organizations/${params.organizationId}/projects/${params.projectId}/schemas`;

  try {
    const deleteId = form.get("delete");
    if (typeof deleteId === "string") {
      await apiVoid(`${base}/${deleteId}`, { method: "DELETE" });
      return { deleted: true };
    }

    const copyFrom = form.get("copyFrom");
    if (typeof copyFrom === "string") {
      await postJson(
        `${base}/copy`,
        CopyFromLibrarySchema,
        { librarySchemaId: copyFrom },
        CopiedContentTypeSchema,
      );
      return { copied: true };
    }

    const restore = form.get("restore");
    const restoreId = form.get("schemaId");
    if (typeof restore === "string" && typeof restoreId === "string") {
      await postJson(
        `${base}/${restoreId}/restore`,
        RestoreContentTypeSchema,
        { hash: restore },
        RestoredContentTypeSchema,
      );
      return { restored: true };
    }

    await postJson(
      base,
      NewContentTypeSchema,
      contentTypeBody(form),
      CreatedContentTypeSchema,
    );
    return { created: true };
  } catch (error) {
    const message = displayableError(error);
    if (message) return { error: message };
    throw error;
  }
}

/**
 * D'où vient un type de contenu, et où il en est par rapport à sa source.
 *
 * ⚠️ **« Modified » ne dit pas *qui* a bougé.** Le diagnostic confond « seule
 * la copie a changé » et « les deux ont changé » (ADR 0018) — le libellé est
 * choisi pour ne pas le survendre, et le titre de l'infobulle le dit en toutes
 * lettres.
 */
function Origin({ origin }: { origin: ContentType["origin"] }) {
  // Un type créé directement n'a pas de provenance, et ce n'est pas un manque.
  if (!origin) return <>—</>;

  // ⚠️ Typé depuis le contrat, donc **exhaustif** : ajouter un état côté
  // serveur casse ce typecheck plutôt que d'afficher un libellé de repli que
  // personne n'aurait relu.
  const reading: Record<
    NonNullable<ContentType["origin"]>["state"],
    readonly [string, string]
  > = {
    identical: ["In sync", "Identical to the library entry it came from"],
    library_ahead: [
      "Library ahead",
      "The library moved on; this copy is still on a state the library had",
    ],
    locally_modified: [
      "Modified",
      "No longer a state the library ever had — this copy, the library, or both have changed",
    ],
  };
  const [label, explanation] = reading[origin.state];

  return (
    <span className="console-identity" title={explanation}>
      {label}
      <code className="console-hint">{origin.name}</code>
    </span>
  );
}

export default function ProjectContentTypes({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const { permissions } = useOutletContext<ProjectContext>();
  const canWrite = permissions.includes("schema.write");
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (actionData && "created" in actionData) setOpen(false);
    if (actionData && "copied" in actionData) setCopying(false);
  }, [actionData]);

  const { history } = loaderData;
  const opened =
    history && loaderData.contentTypes.find((t) => t.id === history.schemaId);

  return (
    <>
      <div className="console-page-header">
        <h1>Content types</h1>
        {canWrite && (
          <div className="console-row-actions">
            {/* Rien à copier n'est pas la même chose que ne pas pouvoir : le
                bouton disparaît quand la bibliothèque est vide, plutôt que
                d'ouvrir une liste vide. */}
            {loaderData.library.length > 0 && (
              <HeaderAction onClick={() => setCopying(true)}>
                Copy from library
              </HeaderAction>
            )}
            <HeaderAction onClick={() => setOpen(true)}>
              + New content type
            </HeaderAction>
          </div>
        )}
      </div>

      {actionData && "error" in actionData && (
        <Banner tone="error">{actionData.error}</Banner>
      )}
      {actionData && "created" in actionData && <Banner>Content type created.</Banner>}
      {actionData && "deleted" in actionData && <Banner>Content type deleted.</Banner>}
      {actionData && "restored" in actionData && <Banner>Version restored.</Banner>}
      {actionData && "copied" in actionData && (
        <Banner>Copied from the library. The copy is independent from now on.</Banner>
      )}

      <Section
        title="Types"
        description="What a document of this project can be. A type's name is its storage key — it ends up in API addresses and generated types."
        first
      >
        {loaderData.contentTypes.length === 0 ? (
          <Empty>
            No content type yet. One describes the fields a document carries — a title,
            a body, a date.
          </Empty>
        ) : (
          <table className="console-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Fields</th>
                <th>Origin</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loaderData.contentTypes.map((type) => (
                <tr key={type.id}>
                  <td>
                    <span className="console-identity">
                      {type.label ?? type.name}
                      {type.label && <code className="console-hint">{type.name}</code>}
                    </span>
                  </td>
                  <td className="console-muted">
                    {type.definition.fields.map((f) => f.name).join(", ") || "—"}
                  </td>
                  <td className="console-muted">
                    <Origin origin={type.origin} />
                  </td>
                  <td className="console-muted">{day(type.updatedAt)}</td>
                  <td>
                    <div className="console-row-actions">
                      {/* Une navigation, pas un état : voir l'en-tête. */}
                      <Link className="console-link-button" to={`?history=${type.id}`}>
                        History
                      </Link>
                      {canWrite && (
                        <Form method="post">
                          <RowAction
                            danger
                            name="delete"
                            value={type.id}
                            disabled={busy}
                          >
                            Delete
                          </RowAction>
                        </Form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Modal open={open} onClose={() => setOpen(false)} title="New content type">
        <Form method="post" className="console-form">
          {/* Remonté à chaque ouverture : sans ça, les lignes de champ ajoutées
              lors de la création précédente resteraient là. */}
          <SchemaFields key={String(open)} />
          <div className="console-actions">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </div>
        </Form>
      </Modal>

      <Modal open={copying} onClose={() => setCopying(false)} title="Copy from library">
        <p className="console-muted">
          The copy is independent: editing the library afterwards never changes what
          this project holds. It keeps the library's name, and this screen tells you
          when the two drift apart.
        </p>

        <table className="console-table">
          <tbody>
            {loaderData.library.map((schema) => (
              <tr key={schema.id}>
                <td>
                  <span className="console-identity">
                    {schema.label ?? schema.name}
                    <code className="console-hint">{schema.name}</code>
                  </span>
                </td>
                <td className="console-muted">
                  {schema.definition.fields.map((f) => f.name).join(", ") || "—"}
                </td>
                <td>
                  <Form method="post">
                    <RowAction name="copyFrom" value={schema.id} disabled={busy}>
                      Copy
                    </RowAction>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>

      <Modal
        open={Boolean(history)}
        onClose={() => navigate(pathname, { replace: true })}
        title={`History — ${opened ? (opened.label ?? opened.name) : "content type"}`}
      >
        {history && (
          <Lineage
            schemaId={history.schemaId}
            currentHash={history.currentHash}
            entries={history.entries}
            canWrite={canWrite}
            busy={busy}
          />
        )}
      </Modal>
    </>
  );
}
