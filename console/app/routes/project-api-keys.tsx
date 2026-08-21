import { useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";
import { api, apiVoid, displayableError, postJson } from "../lib/api";
import {
  type ApiKey,
  ApiKeysSchema,
  CreatedApiKeySchema,
  NewApiKeySchema,
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
import type { Route } from "./+types/project-api-keys";

/**
 * Les clés API d'un projet, rangées par type.
 *
 * ⚠️ **Pas de vue en lecture seule.** Les clés publique et preview sont
 * stockées en clair : les voir, c'est les avoir. La route entière exige
 * `apikey.manage`, et l'entrée de barre latérale disparaît sans elle.
 *
 * La console ne prononce jamais le mot « environnement » : le serveur résout
 * `master`, seul existant (architecture/environments.md).
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const base = `/organizations/${params.organizationId}/projects/${params.projectId}/api-keys`;
  return { keys: await api(base, ApiKeysSchema) };
}

export async function clientAction({ params, request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const base = `/organizations/${params.organizationId}/projects/${params.projectId}/api-keys`;

  try {
    const revokeId = form.get("revoke");
    if (typeof revokeId === "string") {
      await apiVoid(`${base}/${revokeId}/revoke`, { method: "POST" });
      return { revoked: true };
    }

    const deleteId = form.get("delete");
    if (typeof deleteId === "string") {
      // Le serveur refuse de supprimer une clé encore active (409). L'écran
      // n'offre le bouton qu'après révocation, mais c'est un confort : la
      // règle vit dans le service.
      await apiVoid(`${base}/${deleteId}`, { method: "DELETE" });
      return { deleted: true };
    }

    // Le type vient du bouton sur lequel on a cliqué. Le retrouver dans `KINDS`
    // plutôt que de l'affirmer par un `as` : ça le rétrécit au littéral, et une
    // valeur inattendue s'arrête ici au lieu de partir au serveur.
    const kind = KINDS.find((k) => k.kind === form.get("kind"))?.kind;
    if (!kind) throw new Error(`type de clé inconnu : ${form.get("kind")}`);

    const created = await postJson(
      base,
      NewApiKeySchema,
      { kind, name: String(form.get("name")) },
      CreatedApiKeySchema,
    );
    return { created: { ...created, kind } };
  } catch (error) {
    const message = displayableError(error);
    if (message) return { error: message };
    throw error;
  }
}

const KINDS = [
  {
    kind: "public",
    title: "Public",
    description:
      "Read published content. Meant to ship in your site's code — it grants nothing else.",
  },
  {
    kind: "preview",
    title: "Preview",
    description: "Read drafts as well. For preview builds, never for production.",
  },
  {
    kind: "secret",
    title: "Secret",
    description:
      "Read and write everything, including schemas. Shown once, then only its prefix.",
  },
] as const;

/**
 * Copier plutôt que sélectionner à la main : une clé fait soixante caractères
 * et une sélection partielle produit une panne difficile à diagnostiquer.
 */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <RowAction
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          // Le presse-papiers peut être refusé (contexte non sécurisé, refus
          // de l'utilisateur). Ne rien prétendre plutôt que mentir.
          () => setCopied(false),
        );
      }}
    >
      {copied ? "Copied" : "Copy"}
    </RowAction>
  );
}

export default function ProjectApiKeys({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const [newKeyKind, setNewKeyKind] = useState<string | null>(null);
  /**
   * Le jeton fraîchement créé, tenu en état local et non lu d'`actionData` :
   * celui-ci survit jusqu'à la navigation suivante, donc la fenêtre ne pourrait
   * jamais se refermer.
   */
  const [revealed, setRevealed] = useState<{ token: string; kind: string } | null>(
    null,
  );

  useEffect(() => {
    if (!actionData || !("created" in actionData) || !actionData.created) return;
    // Le formulaire se referme, la suite se passe dans la fenêtre qui montre
    // le jeton.
    setNewKeyKind(null);
    setRevealed(actionData.created);
  }, [actionData]);

  return (
    <>
      <div className="console-page-header">
        <h1>API keys</h1>
      </div>

      {actionData && "error" in actionData && (
        <Banner tone="error">{actionData.error}</Banner>
      )}
      {actionData && "revoked" in actionData && (
        <Banner>Key revoked. It stops working immediately.</Banner>
      )}
      {actionData && "deleted" in actionData && <Banner>Key deleted.</Banner>}

      {KINDS.map(({ kind, title, description }, index) => {
        const keys = loaderData.keys.filter((key) => key.kind === kind);
        return (
          <Section
            key={kind}
            title={title}
            description={description}
            first={index === 0}
            action={
              <HeaderAction onClick={() => setNewKeyKind(kind)}>
                + New {kind} key
              </HeaderAction>
            }
          >
            {keys.length === 0 ? (
              <Empty>No {kind} key yet.</Empty>
            ) : (
              <KeyTable keys={keys} busy={busy} />
            )}
          </Section>
        );
      })}

      <Modal
        open={newKeyKind !== null}
        onClose={() => setNewKeyKind(null)}
        title={`New ${newKeyKind} key`}
      >
        <p className="console-muted">
          Name it after what will use it — that's how you know which one to revoke
          later.
        </p>
        <Form method="post" className="console-form">
          <input type="hidden" name="kind" value={newKeyKind ?? ""} />
          <Field label="Name">
            <input className="console-input" name="name" required maxLength={200} />
          </Field>
          <div className="console-modal-actions">
            <Button type="button" onClick={() => setNewKeyKind(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </div>
        </Form>
      </Modal>

      {/* Une fenêtre à elle seule, et pas une ligne de plus dans le tableau :
          pour une clé secrète c'est la seule fois qu'elle est lisible. */}
      <Modal
        open={revealed !== null}
        onClose={() => setRevealed(null)}
        title="Copy this key now"
      >
        {revealed?.kind === "secret" ? (
          <p>
            This is the only time it's shown. Only its prefix remains afterwards — if
            you lose it, create another one and revoke this.
          </p>
        ) : (
          <p className="console-muted">
            You can read this one again from the list at any time.
          </p>
        )}
        <div className="console-token">
          <code>{revealed?.token}</code>
          {revealed && <CopyButton value={revealed.token} />}
        </div>
        <div className="console-modal-actions">
          <Button type="button" variant="primary" onClick={() => setRevealed(null)}>
            Done
          </Button>
        </div>
      </Modal>
    </>
  );
}

function KeyTable({ keys, busy }: { keys: ApiKey[]; busy: boolean }) {
  return (
    <table className="console-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Key</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => (
          <tr key={key.id}>
            <td>
              {key.name}
              {/* Une clé révoquée reste listée : c'est la trace de ce qui a
                  circulé, et le journal d'audit la référence encore. */}
              {key.revokedAt && <span className="console-badge">revoked</span>}
            </td>
            <td>
              <code className="console-muted">{key.token ?? key.hint}</code>
            </td>
            <td>
              <div className="console-row-actions">
                {key.token && !key.revokedAt && <CopyButton value={key.token} />}
                <Form method="post" className="console-row-actions">
                  {key.revokedAt ? (
                    <RowAction danger name="delete" value={key.id} disabled={busy}>
                      Delete
                    </RowAction>
                  ) : (
                    <RowAction danger name="revoke" value={key.id} disabled={busy}>
                      Revoke
                    </RowAction>
                  )}
                </Form>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
