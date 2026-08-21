import { redirect, useNavigation, useOutletContext } from "react-router";
import { api, apiVoid, displayableError, putJson } from "../lib/api";
import {
  ApiKeysSchema,
  ProjectMembersSchema,
  ProjectSettingsSchema,
} from "../lib/api-contract";
import { Banner } from "../ui/controls";
import { DangerZone, SettingsForm } from "../ui/settings-form";
import type { Route } from "./+types/project-settings";
import type { ProjectContext } from "./project";

/**
 * Les réglages d'un projet — deux blocs, là où l'organization en a trois : un
 * projet ne paie pas.
 *
 * ⚠️ Le nom et la description répondent à **`project.settings`**, pas à
 * `org.settings`. Les deux n'en faisaient qu'un jusqu'à la migration 0027 ;
 * réserver les réglages d'organization au owner aurait sinon retiré aux admins
 * le droit de nommer les projets qu'ils créent.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const base = `/organizations/${params.organizationId}/projects/${params.projectId}`;

  // Les permissions viennent de la coque (`project.tsx`), déjà chargées. Ce
  // qui manque ici, ce sont les compteurs qui expliquent un refus de
  // suppression — et eux dépendent de permissions qu'on peut ne pas avoir.
  const [members, keys] = await Promise.all([
    api(`${base}/members`, ProjectMembersSchema).catch(() => []),
    api(`${base}/api-keys`, ApiKeysSchema).catch(() => []),
  ]);

  const active = keys.filter((key) => key.revokedAt === null);

  return {
    blockers: [
      members.length > 0 ? `${members.length} member(s) to remove first.` : null,
      active.length > 0 ? `${active.length} active API key(s) to revoke first.` : null,
    ].filter((blocker): blocker is string => blocker !== null),
  };
}

export async function clientAction({ params, request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const base = `/organizations/${params.organizationId}/projects/${params.projectId}`;

  try {
    if (form.get("intent") === "delete") {
      await apiVoid(base, { method: "DELETE" });
      // Le projet n'existe plus : rester sur sa coque afficherait une barre
      // latérale qui pointe vers du vide.
      return redirect(`/org/${params.organizationId}`);
    }

    await putJson(base, ProjectSettingsSchema, {
      name: String(form.get("name")),
      description: String(form.get("description")),
    });
    return { saved: "Settings saved." };
  } catch (error) {
    const message = displayableError(error);
    if (message) return { error: message };
    throw error;
  }
}

export default function ProjectSettings({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const { project, permissions } = useOutletContext<ProjectContext>();

  return (
    <>
      <div className="console-page-header">
        <h1>Settings</h1>
      </div>

      {actionData && "error" in actionData && (
        <Banner tone="error">{actionData.error}</Banner>
      )}
      {actionData && "saved" in actionData && <Banner>{actionData.saved}</Banner>}

      <SettingsForm
        subject="project"
        name={project.name}
        description={project.description}
        editable={permissions.includes("project.settings")}
        // Un projet ne paie pas : pas d'adresse, donc pas de champ.
        billingAddress={null}
        busy={busy}
      />

      {permissions.includes("project.delete") && (
        <DangerZone subject="project" blockers={loaderData.blockers} busy={busy} />
      )}
    </>
  );
}
