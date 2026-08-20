import { Form, Link, redirect, useNavigation } from "react-router";
import { ApiError, api, postJson } from "../lib/api";
import { authClient } from "../lib/auth";
import type { Route } from "./+types/invite";

type Role = {
  id: string;
  name: string;
  scope: "organization" | "project";
  isSystem: boolean;
};

type PendingInvitation = {
  id: string;
  email: string;
  roleName: string;
  expiresAt: string;
};

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const { data: session } = await authClient.getSession();
  if (!session) throw redirect("/login");

  const base = `/organizations/${params.organizationId}`;
  const [roles, pending] = await Promise.all([
    api<Role[]>(`${base}/roles`),
    api<PendingInvitation[]>(`${base}/invitations`),
  ]);

  return {
    // Un rôle de projet ne s'attribue qu'avec un projet ; le service refuserait
    // la combinaison. Les proposer sans sélecteur de projet serait offrir un
    // choix qui échoue.
    roles: roles.filter((role) => role.scope === "organization"),
    pending,
  };
}

export async function clientAction({ params, request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const base = `/organizations/${params.organizationId}`;

  try {
    const cancelId = form.get("cancel");
    if (typeof cancelId === "string") {
      await api(`${base}/invitations/${cancelId}`, { method: "DELETE" });
      return { cancelled: true };
    }

    await postJson(`${base}/invitations`, {
      email: String(form.get("email")),
      roleId: String(form.get("roleId")),
    });
    return { sent: true };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export default function Invite({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";

  return (
    <div className="console console-centered">
      <div className="console-panel console-panel--wide">
        <div className="console-page-header">
          <h1>Inviter</h1>
          <Link className="console-button" to="/">
            Organizations
          </Link>
        </div>

        {actionData && "error" in actionData && (
          <p className="console-banner console-banner--error">{actionData.error}</p>
        )}
        {actionData && "sent" in actionData && (
          <p className="console-banner">Invitation envoyée.</p>
        )}
        {actionData && "cancelled" in actionData && (
          <p className="console-banner">Invitation annulée.</p>
        )}

        <Form method="post" className="console-inline-form">
          <label className="console-field">
            <span className="console-label">Adresse</span>
            <input className="console-input" name="email" type="email" required />
          </label>

          <label className="console-field">
            <span className="console-label">Rôle</span>
            <select className="console-input" name="roleId" required>
              {loaderData.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>

          <button
            className="console-button console-button--primary"
            type="submit"
            disabled={busy}
          >
            {busy ? "Envoi…" : "Envoyer l'invitation"}
          </button>
        </Form>

        <h2>En attente</h2>
        {loaderData.pending.length === 0 ? (
          <p className="console-muted">Aucune invitation en attente.</p>
        ) : (
          <table className="console-table">
            <thead>
              <tr>
                <th>Adresse</th>
                <th>Rôle</th>
                <th>Expire</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loaderData.pending.map((invitation) => (
                <tr key={invitation.id}>
                  <td>{invitation.email}</td>
                  <td>
                    <span className="console-badge">{invitation.roleName}</span>
                  </td>
                  <td className="console-muted">
                    {new Date(invitation.expiresAt).toLocaleDateString("fr-CA")}
                  </td>
                  <td className="console-row-actions">
                    <Form method="post">
                      <button
                        className="console-button"
                        type="submit"
                        name="cancel"
                        value={invitation.id}
                        disabled={busy}
                      >
                        Annuler
                      </button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
