import { useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";
import {
  api,
  apiVoid,
  displayableError,
  parseBody,
  postJson,
  putJson,
} from "../lib/api";
import {
  CreatedRoleSchema,
  MembershipSchema,
  NewRoleSchema,
  PermissionCatalogueSchema,
  type Role,
  RoleEditSchema,
  RolesSchema,
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
import type { Route } from "./+types/roles";

/**
 * Custom roles.
 *
 * Only an owner writes here (ADR 0014). System roles are shown read-only with
 * what they grant — that is what lets someone compare before composing their
 * own, and it is what GitHub, Contentful and Sanity all do.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const base = `/organizations/${params.organizationId}`;

  const [{ permissions: mine }, roles, catalogue] = await Promise.all([
    api(`${base}/me`, MembershipSchema),
    api(`${base}/roles`, RolesSchema),
    // The catalogue lives in the server's code. Without this route the console
    // has no way to know what permissions exist, so no checkboxes to show.
    api("/permissions", PermissionCatalogueSchema),
  ]);

  return { organizationId: params.organizationId, mine, roles, catalogue };
}

export async function clientAction({ params, request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const base = `/organizations/${params.organizationId}/roles`;

  try {
    const deleteId = form.get("delete");
    if (typeof deleteId === "string") {
      // A held role is refused with a count. The screen does not try to guess
      // — it shows what the server says.
      await apiVoid(`${base}/${deleteId}`, { method: "DELETE" });
      return { deleted: true };
    }

    // Les cases cochées viennent du catalogue que le serveur a envoyé, mais
    // `FormData` les rend en chaînes : c'est le schéma qui les reconnaît.
    const draft = {
      name: String(form.get("name")),
      permissions: form.getAll("permissions").map(String),
    };

    const editId = form.get("edit");
    if (typeof editId === "string" && editId !== "") {
      await putJson(
        `${base}/${editId}`,
        RoleEditSchema,
        parseBody(RoleEditSchema, draft),
      );
      return { saved: true };
    }

    await postJson(
      base,
      NewRoleSchema,
      parseBody(NewRoleSchema, { ...draft, scope: String(form.get("scope")) }),
      CreatedRoleSchema,
    );
    return { saved: true };
  } catch (error) {
    const message = displayableError(error);
    if (message) return { error: message };
    throw error;
  }
}

/** What the window is open on: a role being composed, edited, or just read. */
type Draft = {
  /** Empty when creating — the form keys on it to choose its route. */
  id: string;
  name: string;
  scope: "organization" | "project";
  permissions: string[];
  /** Set when duplicating a system role whose permissions we cannot all grant. */
  omitted: string[];
  /**
   * A built-in role, open to be read. ⚠️ It shows the role **as it is** — the
   * whole catalogue, ticked where granted — rather than filtered to what the
   * reader could grant. Filtering would make `admin` look poorer than it is to
   * anyone who does not hold everything.
   */
  readOnly: boolean;
};

export default function Roles({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (actionData && "saved" in actionData) setDraft(null);
  }, [actionData]);

  const custom = loaderData.roles.filter((role) => !role.isSystem);
  const system = loaderData.roles.filter((role) => role.isSystem);

  /**
   * ⚠️ Only the permissions the caller holds are offered. One cannot grant
   * what one does not hold, so offering the rest would only produce a refusal
   * — and duplicating a role we cannot fully reproduce says which ones were
   * left behind rather than silently differing from the original.
   */
  const duplicate = (role: Role) =>
    setDraft({
      id: "",
      name: `${role.name} copy`,
      scope: role.scope,
      permissions: role.permissions.filter((key) => loaderData.mine.includes(key)),
      omitted: role.permissions.filter((key) => !loaderData.mine.includes(key)),
      readOnly: false,
    });

  const view = (role: Role) =>
    setDraft({
      id: role.id,
      name: role.name,
      scope: role.scope,
      permissions: [...role.permissions],
      omitted: [],
      readOnly: true,
    });

  return (
    <>
      <div className="console-page-header">
        <h1>Roles</h1>
        <HeaderAction
          onClick={() =>
            setDraft({
              id: "",
              name: "",
              scope: "organization",
              permissions: [],
              omitted: [],
              readOnly: false,
            })
          }
        >
          + New role
        </HeaderAction>
      </div>

      {actionData && "error" in actionData && (
        <Banner tone="error">{actionData.error}</Banner>
      )}
      {actionData && "saved" in actionData && <Banner>Role saved.</Banner>}
      {actionData && "deleted" in actionData && <Banner>Role deleted.</Banner>}

      <Section
        title="Custom roles"
        description="Yours to compose. Editing one changes what every holder can do, from their next request on."
        first
      >
        {custom.length === 0 ? (
          <Empty>
            No custom role yet. Duplicate a built-in one below to start from something.
          </Empty>
        ) : (
          <RoleTable
            roles={custom}
            action={(role) => (
              <>
                <RowAction type="button" onClick={() => setDraft(toDraft(role))}>
                  Edit
                </RowAction>
                <Form method="post" className="console-row-actions">
                  <RowAction danger name="delete" value={role.id} disabled={busy}>
                    Delete
                  </RowAction>
                </Form>
              </>
            )}
          />
        )}
      </Section>

      <Section
        title="Built-in roles"
        description="Every organization gets these. They cannot be renamed, edited or deleted — only used as a starting point."
      >
        <RoleTable
          roles={system}
          action={(role) => (
            <>
              {/* Reading comes first: one looks at a role before starting from
                  it, and `owner` can only ever be read. */}
              <RowAction type="button" onClick={() => view(role)}>
                View
              </RowAction>
              {/* ⚠️ Not `owner`. Duplicating it ticks the whole catalogue,
                  which is not a starting point — and the copy would be a
                  full-powered member that the last-owner rule does not count.
                  For a second owner, promote someone to owner. */}
              {role.name !== "owner" && (
                <RowAction type="button" onClick={() => duplicate(role)}>
                  Duplicate
                </RowAction>
              )}
            </>
          )}
        />
      </Section>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={modalTitle(draft)}
      >
        {draft?.readOnly && (
          <p className="console-muted">
            Built-in roles are the same in every organization and cannot be changed.
            Duplicate one to start from it.
          </p>
        )}
        {draft && draft.omitted.length > 0 && (
          <Banner tone="error">
            Left out, because you don't hold them yourself: {draft.omitted.join(", ")}.
          </Banner>
        )}
        <Form method="post" className="console-form">
          <input type="hidden" name="edit" value={draft?.id ?? ""} />
          <input type="hidden" name="scope" value={draft?.scope ?? "organization"} />

          <Field label="Name">
            <input
              className="console-input"
              name="name"
              required
              maxLength={200}
              defaultValue={draft?.name}
              disabled={draft?.readOnly}
            />
          </Field>

          {/* The scope decides where the role can be assigned, so it is fixed
              at creation: moving it would silently widen or narrow everyone
              already wearing it. */}
          {!draft?.id && (
            <Field label="Applies to">
              <select
                className="console-input"
                name="scope"
                defaultValue={draft?.scope}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          scope:
                            event.target.value === "project"
                              ? "project"
                              : "organization",
                        }
                      : current,
                  )
                }
              >
                <option value="organization">The whole organization</option>
                <option value="project">A single project</option>
              </select>
            </Field>
          )}

          <fieldset className="console-permissions">
            <legend>Permissions</legend>
            {/* Reading shows the whole catalogue, ticked where the role grants
                it; composing offers only what the caller could grant. Filtering
                a role one is merely reading would make it look poorer than it
                is. */}
            {loaderData.catalogue
              .filter(
                (permission) =>
                  draft?.readOnly || loaderData.mine.includes(permission.key),
              )
              .map((permission) => (
                <label key={permission.key} className="console-permission">
                  <input
                    type="checkbox"
                    name="permissions"
                    value={permission.key}
                    defaultChecked={draft?.permissions.includes(permission.key)}
                    disabled={draft?.readOnly}
                  />
                  <span>
                    {permission.description}
                    <code className="console-muted"> {permission.key}</code>
                  </span>
                </label>
              ))}
          </fieldset>

          <div className="console-modal-actions">
            {draft?.readOnly ? (
              <Button type="button" variant="primary" onClick={() => setDraft(null)}>
                Close
              </Button>
            ) : (
              <>
                <Button type="button" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </>
            )}
          </div>
        </Form>
      </Modal>
    </>
  );
}

/** `View editor`, `Edit Relecture`, or `New role`. */
const modalTitle = (draft: Draft | null) => {
  if (!draft) return "";
  if (draft.readOnly) return `View ${draft.name}`;
  return draft.id ? `Edit ${draft.name}` : "New role";
};

const toDraft = (role: Role): Draft => ({
  id: role.id,
  name: role.name,
  scope: role.scope,
  permissions: [...role.permissions],
  omitted: [],
  readOnly: false,
});

function RoleTable({
  roles,
  action,
}: {
  roles: Role[];
  action: (role: Role) => React.ReactNode;
}) {
  return (
    <table className="console-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Applies to</th>
          <th>Grants</th>
          <th>Holders</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {roles.map((role) => (
          <tr key={role.id}>
            <td>{role.name}</td>
            <td className="console-muted">
              {role.scope === "project" ? "A single project" : "The organization"}
            </td>
            <td>
              {role.permissions.length === 0 ? (
                <span className="console-muted">Nothing</span>
              ) : (
                <span className="console-muted">
                  {role.permissions.length} permission
                  {role.permissions.length > 1 ? "s" : ""}
                </span>
              )}
            </td>
            {/* Editing a role changes what all of them can do at once — the
                number is what keeps that from happening blind. */}
            <td className="console-muted">{role.holders}</td>
            <td>
              <div className="console-row-actions">{action(role)}</div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
