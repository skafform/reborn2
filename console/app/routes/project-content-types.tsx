import { useEffect, useState } from "react";
import { Form, useNavigation, useOutletContext } from "react-router";
import { api, apiVoid, displayableError, postJson } from "../lib/api";
import {
  ContentTypesSchema,
  CreatedContentTypeSchema,
  NewContentTypeSchema,
} from "../lib/api-contract";
import { contentTypeBody, FIELD_TYPES } from "../lib/content-type-body";
import { day } from "../lib/format";
import {
  Banner,
  Button,
  Empty,
  Field,
  HeaderAction,
  Modal,
  RowAction,
  Section,
} from "../ui/controls";
import type { Route } from "./+types/project-content-types";
import type { ProjectContext } from "./project";

/**
 * Les types de contenu d'un projet.
 *
 * ⚠️ **Le mot « environnement » n'apparaît pas**, ici comme dans l'API : le
 * chemin nomme un projet, et `master` est résolu côté serveur
 * (architecture/environments.md).
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const base = `/organizations/${params.organizationId}/projects/${params.projectId}/schemas`;
  return { contentTypes: await api(base, ContentTypesSchema) };
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

export default function ProjectContentTypes({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const { permissions } = useOutletContext<ProjectContext>();
  const canWrite = permissions.includes("schema.write");
  const [open, setOpen] = useState(false);
  /** Le nombre de lignes de champ offertes — jamais moins d'une. */
  const [rows, setRows] = useState(1);

  useEffect(() => {
    if (actionData && "created" in actionData) {
      setOpen(false);
      setRows(1);
    }
  }, [actionData]);

  return (
    <>
      <div className="console-page-header">
        <h1>Content types</h1>
        {canWrite && (
          <HeaderAction onClick={() => setOpen(true)}>+ New content type</HeaderAction>
        )}
      </div>

      {actionData && "error" in actionData && (
        <Banner tone="error">{actionData.error}</Banner>
      )}
      {actionData && "created" in actionData && <Banner>Content type created.</Banner>}
      {actionData && "deleted" in actionData && <Banner>Content type deleted.</Banner>}

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
                  <td className="console-muted">{day(type.updatedAt)}</td>
                  <td>
                    {canWrite && (
                      <Form method="post" className="console-row-actions">
                        <RowAction danger name="delete" value={type.id} disabled={busy}>
                          Delete
                        </RowAction>
                      </Form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Modal open={open} onClose={() => setOpen(false)} title="New content type">
        <Form method="post" className="console-form">
          <Field label="Name">
            {/* ⚠️ Pas de contrainte recopiée ici : le serveur porte
                l'expression régulière, et la console affiche son refus. */}
            <input className="console-input" name="name" required />
          </Field>

          <Field label="Label">
            <input className="console-input" name="label" />
          </Field>

          <p className="console-muted">
            Fields, in the order they appear. That order is the form layout, so changing
            it changes the type.
          </p>

          {Array.from({ length: rows }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: la position **est** l'identité d'une ligne ici — c'est elle que le serveur reçoit comme ordre des champs.
            <div className="console-field-row" key={index}>
              <input
                className="console-input"
                name="fieldName"
                placeholder="title"
                aria-label="Field name"
              />
              <select
                className="console-input"
                name="fieldType"
                aria-label="Field type"
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              <label className="console-checkbox">
                <input type="checkbox" name="fieldRequired" value={String(index)} />
                Required
              </label>
            </div>
          ))}

          <Button type="button" onClick={() => setRows((count) => count + 1)}>
            + Add a field
          </Button>

          <div className="console-actions">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </div>
        </Form>
      </Modal>
    </>
  );
}
