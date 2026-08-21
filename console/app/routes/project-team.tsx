import { useEffect, useState } from "react";
import { Form, useNavigation, useOutletContext } from "react-router";
import { api, apiVoid, displayableError, postJson } from "../lib/api";
import {
  NewProjectInvitationSchema,
  ProjectInvitationsSchema,
  ProjectMembershipSchema,
  ProjectMembersSchema,
  RolesSchema,
  SentProjectInvitationSchema,
} from "../lib/api-contract";
import { applyMembershipChange } from "../lib/membership-actions";
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
import { MemberActions } from "../ui/member-actions";
import type { Route } from "./+types/project-team";
import type { ProjectContext } from "./project";

/**
 * L'équipe d'un projet, et son recrutement.
 *
 * ⚠️ **Le projet vient de l'URL, jamais d'un menu.** C'est ce qui fait qu'aucune
 * combinaison incohérente n'est composable ici : la modale ne propose que des
 * rôles de portée projet, et l'adresse dit déjà lequel
 * (architecture/invitations.md).
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const base = `/organizations/${params.organizationId}/projects/${params.projectId}`;

  // Les permissions d'abord, comme pour l'équipe de l'organization : demander
  // les invitations sans `member.manage` ferait échouer tout l'écran pour des
  // données dont on n'a pas l'usage.
  const { permissions } = await api(`${base}/me`, ProjectMembershipSchema);
  const canManage = permissions.includes("member.manage");

  const [members, pending, roles] = await Promise.all([
    api(`${base}/members`, ProjectMembersSchema),
    canManage
      ? api(`${base}/invitations`, ProjectInvitationsSchema)
      : Promise.resolve([]),
    canManage
      ? api(`/organizations/${params.organizationId}/roles`, RolesSchema)
      : Promise.resolve([]),
  ]);

  /*
   * Deux filtres, deux raisons différentes de ne pas offrir un choix qui
   * échoue :
   *
   * - la **portée** : ici seuls les rôles de projet s'attribuent, et le
   *   service refuse désormais la combinaison inverse (docs/backlog #0013)
   * - l'**escalade** : on n'accorde pas un rôle qu'on ne peut pas accorder
   */
  const assignable = roles.filter(
    (role) => role.scope === "project" && role.assignable,
  );

  return {
    canManage,
    members,
    pending,
    roles: assignable,
    // Le moins privilégié par défaut, jamais le premier de la liste — sinon le
    // navigateur retient l'ordre de création, et propose le plus puissant.
    defaultRoleId: assignable.find((role) => role.isSystem && role.name === "guest")
      ?.id,
  };
}

export async function clientAction({ params, request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const base = `/organizations/${params.organizationId}/projects/${params.projectId}`;

  try {
    const cancelId = form.get("cancel");
    if (typeof cancelId === "string") {
      // L'annulation reste au niveau de l'organization : une invitation lui
      // appartient, quel que soit le projet qu'elle vise.
      await apiVoid(`/organizations/${params.organizationId}/invitations/${cancelId}`, {
        method: "DELETE",
      });
      return { cancelled: true };
    }

    const membershipChange = await applyMembershipChange(`${base}/members`, form);
    if (membershipChange) return membershipChange;

    await postJson(
      `${base}/invitations`,
      NewProjectInvitationSchema,
      {
        email: String(form.get("email")),
        roleId: String(form.get("roleId")),
      },
      SentProjectInvitationSchema,
    );
    return { sent: true };
  } catch (error) {
    const message = displayableError(error);
    if (message) return { error: message };
    throw error;
  }
}

/** Une date fixe, jamais celle du navigateur : deux personnes doivent lire la
 *  même chose. */
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA");

export default function ProjectTeam({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const [open, setOpen] = useState(false);
  const [roleFor, setRoleFor] = useState<(typeof loaderData.members)[number] | null>(
    null,
  );
  const { project, session } = useOutletContext<ProjectContext>();

  useEffect(() => {
    if (actionData && "sent" in actionData) setOpen(false);
    if (actionData && "roleChanged" in actionData) setRoleFor(null);
  }, [actionData]);

  return (
    <>
      <div className="console-page-header">
        <h1>Team</h1>
        {loaderData.canManage && (
          <HeaderAction onClick={() => setOpen(true)}>+ New Invitation</HeaderAction>
        )}
      </div>

      {actionData && "error" in actionData && (
        <Banner tone="error">{actionData.error}</Banner>
      )}
      {actionData && "sent" in actionData && <Banner>Invitation sent.</Banner>}
      {actionData && "cancelled" in actionData && (
        <Banner>Invitation cancelled.</Banner>
      )}
      {actionData && "removed" in actionData && <Banner>Member removed.</Banner>}
      {actionData && "suspended" in actionData && (
        <Banner>
          {actionData.suspended ? "Access suspended." : "Access restored."}
        </Banner>
      )}
      {actionData && "roleChanged" in actionData && <Banner>Role changed.</Banner>}

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
        description="People attached to this project only. They don't belong to the organization."
        first={!loaderData.canManage}
      >
        {loaderData.members.length === 0 ? (
          <Empty>
            No one is attached to this project yet. Organization members already have
            access to it.
          </Empty>
        ) : (
          <table className="console-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loaderData.members.map((member) => (
                <tr key={member.userId}>
                  <td>{member.name}</td>
                  <td>{member.email}</td>
                  <td>
                    <span className="console-badge">{member.roleName}</span>
                    {member.suspendedAt && (
                      <span className="console-badge">suspended</span>
                    )}
                  </td>
                  <td className="console-muted">{day(member.joinedAt)}</td>
                  <td>
                    <MemberActions
                      member={member}
                      isSelf={member.userId === session.id}
                      busy={busy}
                      onChangeRole={() => setRoleFor(member)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Modal
        open={roleFor !== null}
        onClose={() => setRoleFor(null)}
        title={`Change role for ${roleFor?.name ?? ""}`}
      >
        <Form method="post" className="console-form">
          <input type="hidden" name="changeRoleFor" value={roleFor?.userId ?? ""} />
          <Field label="Role">
            <select
              className="console-input"
              name="roleId"
              required
              defaultValue={roleFor?.roleId}
            >
              {loaderData.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="console-modal-actions">
            <Button type="button" onClick={() => setRoleFor(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </Form>
      </Modal>

      <Modal
        open={open && loaderData.canManage}
        onClose={() => setOpen(false)}
        title="New invitation"
      >
        {actionData && "error" in actionData && (
          <Banner tone="error">{actionData.error}</Banner>
        )}
        <p className="console-muted">
          They'll get access to {project.name}, and to nothing else in this
          organization.
        </p>
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
