import { redirect, useNavigation, useOutletContext } from "react-router";
import { api, apiVoid, displayableError, putJson } from "../lib/api";
import {
  BillingSchema,
  MembershipSchema,
  MembersSchema,
  OrganizationSettingsSchema,
  ProjectsSchema,
} from "../lib/api-contract";
import { Banner } from "../ui/controls";
import { DangerZone, SettingsForm } from "../ui/settings-form";
import type { Route } from "./+types/organization-settings";
import type { OrganizationContext } from "./organization";

/**
 * Les réglages d'une organization.
 *
 * ⚠️ **Un seul enregistrement, trois permissions quand même.** `org.settings`
 * commande le formulaire, `org.billing` la seule adresse, `org.delete` la zone
 * rouge. L'adresse est **facultative dans le corps** : la console ne l'envoie
 * que si elle l'a affichée, ce qui garde les deux clés distinctes sans imposer
 * deux boutons.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const base = `/organizations/${params.organizationId}`;

  const { permissions } = await api(`${base}/me`, MembershipSchema);
  const canBill = permissions.includes("org.billing");
  const canDelete = permissions.includes("org.delete");

  const [projects, members, billing] = await Promise.all([
    // Ce qui empêche la suppression. On le demande pour l'expliquer avant le
    // clic — ⚠️ **le serveur refuse de toute façon** : c'est un confort, pas
    // le garde-fou (architecture/admin-ui.md).
    canDelete ? api(`${base}/projects`, ProjectsSchema) : Promise.resolve([]),
    canDelete ? api(`${base}/members`, MembersSchema) : Promise.resolve([]),
    // Lue seulement si on y a droit : sinon le 403 ferait échouer tout l'écran
    // pour une donnée qu'on n'affichera pas.
    canBill ? api(`${base}/billing`, BillingSchema) : Promise.resolve(null),
  ]);

  return {
    canEdit: permissions.includes("org.settings"),
    canDelete,
    // `null` quand la clé manque : le champ disparaît du formulaire, donc du
    // corps, donc l'adresse stockée n'est pas touchée.
    billingAddress: canBill ? (billing?.billingAddress ?? "") : null,
    blockers: [
      projects.length > 0 ? `${projects.length} project(s) to delete first.` : null,
      members.length > 1
        ? `${members.length - 1} other member(s) to remove first.`
        : null,
    ].filter((blocker): blocker is string => blocker !== null),
  };
}

export async function clientAction({ params, request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const base = `/organizations/${params.organizationId}`;

  try {
    if (form.get("intent") === "delete") {
      await apiVoid(base, { method: "DELETE" });
      // Il n'y a plus d'organization sous laquelle vivre : la racine réoriente
      // vers une autre, ou en crée une.
      return redirect("/");
    }

    // ⚠️ Le champ n'est dans le formulaire que si on avait la clé pour le
    // voir. Absent, il ne part pas — et le serveur laisse l'adresse en place
    // plutôt que d'exiger `org.billing` de qui ne fait que renommer.
    const billing = form.get("billingAddress");

    await putJson(base, OrganizationSettingsSchema, {
      name: String(form.get("name")),
      description: String(form.get("description")),
      ...(billing === null
        ? {}
        : // `null` plutôt qu'une chaîne vide : ici les deux diffèrent, « pas
          // encore renseignée » n'étant pas « effacée ».
          { billingAddress: String(billing).trim() === "" ? null : String(billing) }),
    });
    return { saved: "Settings saved." };
  } catch (error) {
    const message = displayableError(error);
    if (message) return { error: message };
    throw error;
  }
}

export default function OrganizationSettings({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const { current } = useOutletContext<OrganizationContext>();

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
        subject="organization"
        name={current.name}
        description={current.description}
        editable={loaderData.canEdit}
        billingAddress={loaderData.billingAddress}
        busy={busy}
      />

      {loaderData.canDelete && (
        <DangerZone subject="organization" blockers={loaderData.blockers} busy={busy} />
      )}
    </>
  );
}
