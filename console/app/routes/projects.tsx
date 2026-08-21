import { useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";
import { ApiError, api, apiErrorMessage, postJson } from "../lib/api";
import { CreatedProjectSchema, ProjectsSchema } from "../lib/api-contract";
import { Banner, Button, Empty, Field, HeaderAction, Modal } from "../ui/controls";
import type { Route } from "./+types/projects";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  // La session est déjà exigée par la coque : cet écran ne la revérifie pas.
  return {
    projects: await api(
      `/organizations/${params.organizationId}/projects`,
      ProjectsSchema,
    ),
  };
}

export async function clientAction({ params, request }: Route.ClientActionArgs) {
  const form = await request.formData();
  try {
    await postJson(
      `/organizations/${params.organizationId}/projects`,
      CreatedProjectSchema,
      { name: String(form.get("name")) },
    );
    return { created: true };
  } catch (error) {
    if (error instanceof ApiError) return { error: apiErrorMessage(error) };
    throw error;
  }
}

export default function Projects({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const [open, setOpen] = useState(false);

  // Un `actionData` neuf arrive à chaque soumission — cet effet referme donc
  // le modal à chaque création réussie, y compris une deuxième fois s'il a
  // été rouvert entre-temps.
  useEffect(() => {
    if (actionData && "created" in actionData) setOpen(false);
  }, [actionData]);

  return (
    <>
      <div className="console-page-header">
        <h1>Projects</h1>
        <HeaderAction onClick={() => setOpen(true)}>+ New Project</HeaderAction>
      </div>

      {loaderData.projects.length === 0 ? (
        <Empty>
          No projects yet. Add one to get started — it's what will hold your content
          types and documents.
        </Empty>
      ) : (
        <table className="console-table">
          <thead>
            <tr>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            {loaderData.projects.map((project) => (
              <tr key={project.id}>
                <td>{project.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New project">
        {actionData?.error && <Banner tone="error">{actionData.error}</Banner>}
        <p className="console-muted">
          It's created with its master environment, where all its content will live.
        </p>
        <Form method="post" className="console-form">
          <Field label="Project name">
            <input className="console-input" name="name" required maxLength={200} />
          </Field>
          <div className="console-modal-actions">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </div>
        </Form>
      </Modal>
    </>
  );
}
