import { Form } from "react-router";
import { Button, Field, Section } from "./controls";

/**
 * Name and description — the same form for an organization and a project.
 *
 * ⚠️ **One form, one Save.** Separate forms would mean a partial update per
 * field — "absent means unchanged" — which forces a decision about what an
 * absent *and* empty description means, and leaves a lost-update window when
 * two are submitted in quick succession.
 *
 * The billing address is the one field that **is** optional in the body, and
 * for a reason that has nothing to do with looks: it answers to `org.billing`
 * rather than `org.settings`. Sending it only when it was shown is what keeps
 * the two keys distinct inside a single request.
 */
export function SettingsForm({
  subject,
  name,
  description,
  editable,
  billingAddress,
  busy,
}: {
  /** "organization" or "project" — what the sentences under the fields name. */
  subject: string;
  name: string;
  description: string;
  /** False for someone who may see the screen but not change it. */
  editable: boolean;
  /**
   * ⚠️ **`null` means "do not show it"**, not "it is empty" — a project has no
   * billing at all, and neither has someone without `org.billing`. The field
   * is then absent from the form, so absent from the body, so the server
   * leaves any stored address alone.
   */
  billingAddress: string | null;
  busy: boolean;
}) {
  return (
    <Section
      title="General"
      description={`What this ${subject} is called, and what it is for.`}
      first
    >
      <Form method="post" className="console-form">
        <input type="hidden" name="intent" value="settings" />

        <Field label="Name">
          <input
            className="console-input"
            name="name"
            required
            maxLength={200}
            defaultValue={name}
            readOnly={!editable}
          />
        </Field>

        <Field label="Description">
          <textarea
            className="console-input"
            name="description"
            rows={3}
            maxLength={1000}
            defaultValue={description}
            readOnly={!editable}
          />
        </Field>

        {billingAddress !== null && (
          <Field label="Billing address">
            {/* Une seule ligne, et un champ libre : l'adresse qui fera foi
                appartiendra au prestataire de paiement, avec ses propres
                champs. Une colonne se supprime, six se migrent. */}
            <input
              className="console-input"
              name="billingAddress"
              maxLength={500}
              defaultValue={billingAddress}
              readOnly={!editable}
            />
          </Field>
        )}

        {editable && (
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        )}
      </Form>
    </Section>
  );
}

/**
 * What cannot be undone, and what still stands in the way.
 *
 * ⚠️ **The reason comes before the click.** Both deletions refuse for good
 * reasons — an organization only goes once emptied, a project not while a key
 * still opens it. A button that fails afterwards turns a clear rule into a
 * mystery, so the blockers are listed and the button is disabled.
 */
export function DangerZone({
  subject,
  blockers,
  busy,
}: {
  subject: string;
  /** Each one a sentence naming what to empty first. Empty means it can go. */
  blockers: string[];
  busy: boolean;
}) {
  return (
    <Section
      title="Danger zone"
      description={`Deleting this ${subject} cannot be undone.`}
    >
      {blockers.length > 0 && (
        <ul className="console-blockers">
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}

      <Form method="post" className="console-form">
        <input type="hidden" name="intent" value="delete" />
        <Button type="submit" variant="danger" disabled={busy || blockers.length > 0}>
          Delete this {subject}
        </Button>
      </Form>
    </Section>
  );
}
