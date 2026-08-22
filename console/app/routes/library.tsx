import { useEffect, useState } from "react";
import { Form, Link, useLocation, useNavigate, useNavigation } from "react-router";
import { api, apiVoid, displayableError, postJson } from "../lib/api";
import {
  CreatedLibrarySchemaSchema,
  LibraryHistorySchema,
  LibrarySchemasSchema,
  MembershipSchema,
  NewLibrarySchemaSchema,
  RestoredLibrarySchemaSchema,
  RestoreLibrarySchemaSchema,
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
import type { Route } from "./+types/library";

/**
 * La bibliothèque de schémas de l'organization
 * ([ADR 0018](../../../docs/adr/0018-bibliotheque-de-schemas-table-separee.md)).
 *
 * ⚠️ **Aucun projet dans l'adresse, et aucun environnement.** Une entrée de
 * bibliothèque appartient à l'organization seule — c'est ce qui la distingue
 * d'un type de contenu.
 *
 * ⚠️ **Deux permissions, pas une** : `schema.read` pour regarder, et
 * `library.write` pour curer. Elles sont distinctes parce que le défaut de la
 * seconde sera probablement revisité — d'où une lecture large et une écriture
 * qui a sa propre clé.
 */
export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  const base = `/organizations/${params.organizationId}/library`;
  const opened = new URL(request.url).searchParams.get("history");

  const [schemas, membership, history] = await Promise.all([
    api(base, LibrarySchemasSchema),
    api(`/organizations/${params.organizationId}/me`, MembershipSchema),
    opened ? api(`${base}/${opened}/history`, LibraryHistorySchema) : null,
  ]);

  return {
    schemas,
    permissions: membership.permissions,
    history: opened && history ? { schemaId: opened, ...history } : null,
  };
}

export async function clientAction({ params, request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const base = `/organizations/${params.organizationId}/library`;

  try {
    const deleteId = form.get("delete");
    if (typeof deleteId === "string") {
      await apiVoid(`${base}/${deleteId}`, { method: "DELETE" });
      return { deleted: true };
    }

    const restore = form.get("restore");
    const restoreId = form.get("schemaId");
    if (typeof restore === "string" && typeof restoreId === "string") {
      await postJson(
        `${base}/${restoreId}/restore`,
        RestoreLibrarySchemaSchema,
        { hash: restore },
        RestoredLibrarySchemaSchema,
      );
      return { restored: true };
    }

    await postJson(
      base,
      NewLibrarySchemaSchema,
      contentTypeBody(form),
      CreatedLibrarySchemaSchema,
    );
    return { created: true };
  } catch (error) {
    const message = displayableError(error);
    if (message) return { error: message };
    throw error;
  }
}

export default function Library({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const canWrite = loaderData.permissions.includes("library.write");
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (actionData && "created" in actionData) setOpen(false);
  }, [actionData]);

  const { history } = loaderData;
  const opened = history && loaderData.schemas.find((s) => s.id === history.schemaId);

  return (
    <>
      <div className="console-page-header">
        <h1>Library</h1>
        {canWrite && (
          <HeaderAction onClick={() => setOpen(true)}>+ New content type</HeaderAction>
        )}
      </div>

      {actionData && "error" in actionData && (
        <Banner tone="error">{actionData.error}</Banner>
      )}
      {actionData && "created" in actionData && <Banner>Content type added.</Banner>}
      {actionData && "deleted" in actionData && <Banner>Content type removed.</Banner>}
      {actionData && "restored" in actionData && <Banner>Version restored.</Banner>}

      <Section
        title="Shared content types"
        description="Content types this organization offers its projects. Copying one into a project makes an independent copy — editing the library never changes what a project already has."
        first
      >
        {loaderData.schemas.length === 0 ? (
          <Empty>
            Nothing in the library yet. A content type put here can be copied into any
            project, as a starting point rather than a link.
          </Empty>
        ) : (
          <table className="console-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Fields</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loaderData.schemas.map((schema) => (
                <tr key={schema.id}>
                  <td>
                    <span className="console-identity">
                      {schema.label ?? schema.name}
                      {schema.label && (
                        <code className="console-hint">{schema.name}</code>
                      )}
                    </span>
                  </td>
                  <td className="console-muted">
                    {schema.definition.fields.map((f) => f.name).join(", ") || "—"}
                  </td>
                  <td className="console-muted">{day(schema.updatedAt)}</td>
                  <td>
                    <div className="console-row-actions">
                      <Link
                        className="console-link-button"
                        to={`?history=${schema.id}`}
                      >
                        History
                      </Link>
                      {canWrite && (
                        <Form method="post">
                          <RowAction
                            danger
                            name="delete"
                            value={schema.id}
                            disabled={busy}
                          >
                            Remove
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

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New library content type"
      >
        <Form method="post" className="console-form">
          <SchemaFields key={String(open)} />
          <div className="console-actions">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Adding…" : "Add"}
            </Button>
          </div>
        </Form>
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
