import { Form, redirect, useNavigation } from "react-router";
import { api, displayableError } from "../lib/api";
import {
  AcceptedFromInboxSchema,
  ReceivedInvitationsSchema,
} from "../lib/api-contract";
import { Banner, Empty, RowAction } from "../ui/controls";
import type { Route } from "./+types/inbox";

/**
 * Les invitations reçues par la personne connectée, tous locataires
 * confondus.
 *
 * La session est déjà exigée par la coque. Aucun `organizationId` n'est
 * transmis : cette liste ne dépend pas de l'organization courante, seulement
 * de l'adresse de la session vérifiée.
 */
export async function clientLoader() {
  return { invitations: await api("/inbox", ReceivedInvitationsSchema) };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();

  try {
    const result = await api(
      `/inbox/${String(form.get("accept"))}/accept`,
      AcceptedFromInboxSchema,
      { method: "POST" },
    );
    // Vers l'organization qu'on vient de rejoindre, pas vers celle d'où on
    // vient : accepter une invitation, c'est y aller.
    return redirect(`/org/${result.organizationId}`);
  } catch (error) {
    const message = displayableError(error);
    if (message) return { error: message };
    throw error;
  }
}

/** Une date fixe, jamais celle du navigateur : deux personnes doivent lire la
 *  même chose. */
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA");

export default function Inbox({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";

  return (
    <>
      <h1>Inbox</h1>

      {actionData?.error && <Banner tone="error">{actionData.error}</Banner>}

      {loaderData.invitations.length === 0 ? (
        <Empty>
          Nothing waiting. Invitations to join other organizations show up here.
        </Empty>
      ) : (
        <table className="console-table">
          <thead>
            <tr>
              <th>Organization</th>
              {/* Une invitation de projet dit *sur quoi* — « Ideatrove —
                  editor » ne suffirait pas. La colonne reste même quand
                  aucune n'en vise un : son absence déplacerait les autres. */}
              <th>Project</th>
              <th>Role</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loaderData.invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td>{invitation.organizationName}</td>
                <td className="console-muted">
                  {invitation.projectName ?? "Whole organization"}
                </td>
                <td>
                  <span className="console-badge">{invitation.roleName}</span>
                </td>
                <td className="console-muted">{day(invitation.expiresAt)}</td>
                <td>
                  <Form method="post" className="console-row-actions">
                    <RowAction name="accept" value={invitation.id} disabled={busy}>
                      Accept
                    </RowAction>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
