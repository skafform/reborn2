import { useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";
import { ApiError, api, apiErrorMessage, apiVoid, postJson } from "../lib/api";
import {
  MembershipSchema,
  MembersSchema,
  PendingInvitationsSchema,
  RolesSchema,
  SentInvitationSchema,
} from "../lib/api-contract";
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
import type { Route } from "./+types/team";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const base = `/organizations/${params.organizationId}`;

  // Les permissions d'abord : les invitations en attente et la liste des rôles
  // relèvent du recrutement, donc de `member.manage`. Les demander sans ce
  // droit ferait échouer tout l'écran pour des données dont on n'a pas l'usage.
  const { permissions } = await api(`${base}/me`, MembershipSchema);
  const canManage = permissions.includes("member.manage");

  const [members, pending, roles] = await Promise.all([
    api(`${base}/members`, MembersSchema),
    canManage
      ? api(`${base}/invitations`, PendingInvitationsSchema)
      : Promise.resolve([]),
    canManage ? api(`${base}/roles`, RolesSchema) : Promise.resolve([]),
  ]);

  /*
   * Deux filtres, deux raisons différentes de ne pas offrir un choix qui
   * échoue :
   *
   * - la **portée** : un rôle de projet ne s'attribue qu'avec un projet, et le
   *   service refuserait la combinaison
   * - l'**escalade** : on n'accorde pas un rôle qu'on ne peut pas accorder. Un
   *   `admin` voyait `owner` et `admin` dans le menu, et son invitation
   *   échouait en 403 — le cas rencontré
   */
  const assignable = roles.filter(
    (role) => role.scope === "organization" && role.assignable,
  );

  return {
    canManage,
    members,
    roles: assignable,
    /**
     * `viewer` par défaut, jamais le premier de la liste.
     *
     * Sans ça le navigateur retient `owner` — l'ordre de création — soit le
     * rôle le plus puissant, et celui qu'un `admin` ne peut de toute façon pas
     * accorder : l'invitation échouait si on ne touchait pas au menu. Le moins
     * privilégié est aussi le plus sûr à proposer par défaut.
     *
     * Le rôle système, pas un rôle personnalisé qui porterait le même nom :
     * `viewer` système existe dans toute organization et ne peut être ni
     * supprimé ni renommé.
     */
    defaultRoleId: assignable.find((role) => role.isSystem && role.name === "viewer")
      ?.id,
    pending,
  };
}

export async function clientAction({ params, request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const base = `/organizations/${params.organizationId}`;

  try {
    const cancelId = form.get("cancel");
    if (typeof cancelId === "string") {
      await apiVoid(`${base}/invitations/${cancelId}`, { method: "DELETE" });
      return { cancelled: true };
    }

    await postJson(`${base}/invitations`, SentInvitationSchema, {
      email: String(form.get("email")),
      roleId: String(form.get("roleId")),
    });
    return { sent: true };
  } catch (error) {
    if (error instanceof ApiError) return { error: apiErrorMessage(error) };
    throw error;
  }
}

/** Une date fixe, jamais celle du navigateur : deux personnes doivent lire la
 *  même chose. */
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA");

export default function Team({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const [open, setOpen] = useState(false);

  // Un `actionData` neuf arrive à chaque soumission — cet effet referme donc
  // le modal à chaque envoi réussi. Il ne réagit qu'à `sent` : une annulation
  // depuis le tableau ne doit pas fermer un modal qui n'était pas ouvert pour
  // ça.
  useEffect(() => {
    if (actionData && "sent" in actionData) setOpen(false);
  }, [actionData]);

  return (
    <>
      <div className="console-page-header">
        <h1>Team</h1>
        {loaderData.canManage && (
          <HeaderAction onClick={() => setOpen(true)}>+ New Invitation</HeaderAction>
        )}
      </div>

      {/* Deux actions distinctes partagent ce même canal d'erreur — annuler une
          invitation, en envoyer une. La bannière de page couvre la première (le
          modal est alors fermé) ; celle du modal couvre la seconde. */}
      {actionData && "error" in actionData && (
        <Banner tone="error">{actionData.error}</Banner>
      )}
      {actionData && "sent" in actionData && <Banner>Invitation sent.</Banner>}
      {actionData && "cancelled" in actionData && (
        <Banner>Invitation cancelled.</Banner>
      )}

      {/* Section entière conditionnée : une invitation en attente relève du
          recrutement, pas de l'annuaire. Un `viewer` n'a pas à savoir qui est
          en train d'être admis. */}
      {loaderData.canManage && (
        <Section
          title="Pending invitations"
          description="Each targets one address and expires after seven days."
          first
        >
          {loaderData.pending.length === 0 ? (
            <Empty>No pending invitations.</Empty>
          ) : (
            <table className="console-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Expires</th>
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
                    <td className="console-muted">{day(invitation.expiresAt)}</td>
                    <td>
                      <Form method="post" className="console-row-actions">
                        <RowAction
                          danger
                          name="cancel"
                          value={invitation.id}
                          disabled={busy}
                        >
                          Cancel
                        </RowAction>
                      </Form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      <Section
        title="Members"
        description="People attached to the organization. An organization role covers all its projects."
        // Sans la section précédente, celle-ci ouvre la page : pas de règle
        // horizontale au-dessus du premier contenu.
        first={!loaderData.canManage}
      >
        <table className="console-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {loaderData.members.map((member) => (
              <tr key={member.userId}>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>
                  <span
                    className={`console-badge${member.roleName === "owner" ? " console-badge--accent" : ""}`}
                  >
                    {member.roleName}
                  </span>
                </td>
                <td className="console-muted">{day(member.joinedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* `canManage` explicitement, plutôt que de compter sur l'absence du
          bouton qui l'ouvre : un modal dont le formulaire échouerait de toute
          façon n'a pas à exister dans l'arbre. */}
      <Modal
        open={open && loaderData.canManage}
        onClose={() => setOpen(false)}
        title="New invitation"
      >
        {actionData?.error && <Banner tone="error">{actionData.error}</Banner>}
        <Form method="post" className="console-form">
          <Field label="Email">
            <input className="console-input" name="email" type="email" required />
          </Field>
          <Field label="Role">
            <select
              className="console-input"
              name="roleId"
              required
              defaultValue={loaderData.defaultRoleId}
            >
              {loaderData.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="console-modal-actions">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Sending…" : "Send invitation"}
            </Button>
          </div>
        </Form>
      </Modal>
    </>
  );
}
