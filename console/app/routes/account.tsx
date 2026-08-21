import { useEffect, useRef } from "react";
import { Form, useNavigation, useOutletContext } from "react-router";
import { authClient, authErrorMessage } from "../lib/auth";
import { Banner, Button, Field, Section } from "../ui/controls";
import type { Route } from "./+types/account";
import type { OrganizationContext } from "./organization";

/** Which of the two forms acted, so a banner lands under the one it answers. */
type Intent = "name" | "password";

/**
 * The account itself, not a membership in it.
 *
 * ⚠️ **No route of ours is involved.** Better-Auth already serves
 * `/update-user` and `/change-password`, and the client published with it *is*
 * their contract — `lib/auth.ts` explains why we never re-type those addresses
 * by hand. Nothing here reaches the OpenAPI spec, so nothing here needs
 * `api:sync`.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();

  if (form.get("intent") === "name") {
    const { error } = await authClient.updateUser({ name: String(form.get("name")) });
    if (error) return { intent: "name" as Intent, error: authErrorMessage(error) };
    return { intent: "name" as Intent, done: "Name updated." };
  }

  // The only other form on the page.
  const { error } = await authClient.changePassword({
    currentPassword: String(form.get("currentPassword")),
    newPassword: String(form.get("newPassword")),
    // One changes a password because it may be known to someone else. Leaving
    // that someone's session open would defeat the point — Better-Auth drops
    // every session and hands this browser a fresh one, so only here survives.
    revokeOtherSessions: true,
  });
  if (error) return { intent: "password" as Intent, error: authErrorMessage(error) };
  return {
    intent: "password" as Intent,
    done: "Password changed. Any other session was signed out.",
  };
}

export default function Account({ actionData }: Route.ComponentProps) {
  const { user } = useOutletContext<OrganizationContext>();
  const busy = useNavigation().state !== "idle";

  // `actionData` is shared by both forms; the intent says whose answer it is.
  const answer = (intent: Intent) =>
    actionData?.intent === intent ? actionData : undefined;
  const forName = answer("name");
  const forPassword = answer("password");

  // Leaving a password sitting in a field once it has been accepted serves
  // nothing. Keyed on `actionData` rather than on the message, so two changes
  // in a row both clear — the same text twice wouldn't fire the effect again.
  const passwordForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (actionData?.intent === "password" && actionData.done)
      passwordForm.current?.reset();
  }, [actionData]);

  return (
    <>
      <div className="console-page-header">
        <h1>Account</h1>
      </div>

      <Section
        title="Profile"
        description="Your name is what other members of an organization see next to your address."
        first
      >
        {forName?.error && <Banner tone="error">{forName.error}</Banner>}
        {forName?.done && <Banner>{forName.done}</Banner>}

        <Form method="post" className="console-form">
          <input type="hidden" name="intent" value="name" />
          <Field label="Name">
            <input
              className="console-input"
              name="name"
              required
              autoComplete="name"
              defaultValue={user.name}
            />
          </Field>

          <Field label="Email">
            {/* Read-only rather than absent: seeing which account one is signed
                in as is the first thing this screen is for. Changing it is out
                of scope — a pending invitation matches on the address, and the
                two would diverge (backend `src/auth.ts`).

                `readOnly`, not `disabled`: a disabled field leaves the tab
                order, so a keyboard could no longer reach the one value this
                section exists to show. */}
            <input className="console-input" value={user.email} readOnly />
          </Field>
          <p className="console-muted">
            Email can't be changed here — an invitation already sent is matched on the
            address it was sent to.
          </p>

          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </Form>
      </Section>

      <Section
        title="Password"
        description="Changing it signs out every other browser and device."
      >
        {forPassword?.error && <Banner tone="error">{forPassword.error}</Banner>}
        {forPassword?.done && <Banner>{forPassword.done}</Banner>}

        <Form method="post" className="console-form" ref={passwordForm}>
          <input type="hidden" name="intent" value="password" />
          <Field label="Current password">
            <input
              className="console-input"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
            />
          </Field>

          <Field label="New password">
            <input
              className="console-input"
              name="newPassword"
              type="password"
              required
              // Same floor as signup — the server refuses shorter, and saying so
              // before the round trip is cheaper than after it.
              minLength={8}
              autoComplete="new-password"
            />
          </Field>

          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Changing…" : "Change password"}
          </Button>
        </Form>
      </Section>
    </>
  );
}
