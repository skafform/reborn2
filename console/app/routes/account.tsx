import { useEffect, useRef } from "react";
import { Form, useNavigation, useOutletContext } from "react-router";
import { api } from "../lib/api";
import { AuthProvidersSchema } from "../lib/api-contract";
import { authClient, authErrorMessage } from "../lib/auth";
import { day } from "../lib/format";
import { Banner, Button, Field, RowAction, Section } from "../ui/controls";
import { knownProviders, providerLabel } from "../ui/providers";
import type { Route } from "./+types/account";
import type { OrganizationContext } from "./organization";
import { resetRedirectTo } from "./reset-password";

/** Which form acted, so a banner lands under the one it answers. */
type Intent = "name" | "password" | "accounts";

/**
 * ⚠️ **Better-Auth's own name for a password.** Its accounts are keyed by
 * provider, and an email/password one is a provider like any other — so having
 * a password is only ever read as "is there a `credential` account".
 */
const PASSWORD = "credential";

/**
 * The account itself, not a membership in it.
 *
 * ⚠️ **Only one route of ours is involved**, and only to ask which providers
 * this deployment offers. Better-Auth already serves `/update-user`,
 * `/change-password`, `/list-accounts`, `/link-social` and `/unlink-account`,
 * and the client published with it *is* their contract — `lib/auth.ts`
 * explains why we never re-type those addresses by hand.
 */
export async function clientLoader() {
  const [{ providers }, accounts] = await Promise.all([
    api("/auth-providers", AuthProvidersSchema),
    authClient.listAccounts(),
  ]);
  return { providers, accounts: accounts.data ?? [] };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "name") {
    const { error } = await authClient.updateUser({ name: String(form.get("name")) });
    if (error) return { intent: "name" as Intent, error: authErrorMessage(error) };
    return { intent: "name" as Intent, done: "Name updated." };
  }

  if (intent === "unlink") {
    const { error } = await authClient.unlinkAccount({
      accountId: String(form.get("accountId")),
    });
    if (error) return { intent: "accounts" as Intent, error: authErrorMessage(error) };
    return { intent: "accounts" as Intent, done: "Disconnected." };
  }

  // Sans mot de passe, il n'y en a pas d'ancien à confirmer — et
  // `setPassword` de Better-Auth est `serverOnly`, donc hors d'atteinte. Le
  // lien de réinitialisation **crée** le compte credential absent : c'est le
  // même chemin, et il prouve la possession de l'adresse au passage.
  if (intent === "set-password") {
    const { error } = await authClient.requestPasswordReset({
      email: String(form.get("email")),
      redirectTo: resetRedirectTo(),
    });
    if (error) return { intent: "password" as Intent, error: authErrorMessage(error) };
    return { intent: "password" as Intent, done: "Check your inbox for the link." };
  }

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

export default function Account({ actionData, loaderData }: Route.ComponentProps) {
  const { user } = useOutletContext<OrganizationContext>();
  const busy = useNavigation().state !== "idle";
  const { providers, accounts } = loaderData;

  const hasPassword = accounts.some((account) => account.providerId === PASSWORD);
  const linked = accounts.filter((account) => account.providerId !== PASSWORD);
  const linkable = knownProviders(providers).filter(
    (provider) => !linked.some((account) => account.providerId === provider.id),
  );

  // `actionData` is shared by every form; the intent says whose answer it is.
  const answer = (intent: Intent) =>
    actionData?.intent === intent ? actionData : undefined;
  const forName = answer("name");
  const forPassword = answer("password");
  const forAccounts = answer("accounts");

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
        description={
          hasPassword
            ? "Changing it signs out every other browser and device."
            : "This account has no password — it signs in through a provider."
        }
      >
        {forPassword?.error && <Banner tone="error">{forPassword.error}</Banner>}
        {forPassword?.done && <Banner>{forPassword.done}</Banner>}

        {hasPassword ? (
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
                // Same floor as signup — the server refuses shorter, and saying
                // so before the round trip is cheaper than after it.
                minLength={8}
                autoComplete="new-password"
              />
            </Field>

            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Changing…" : "Change password"}
            </Button>
          </Form>
        ) : (
          // Pas de champ « mot de passe actuel » à demander, et pas de champ
          // « nouveau » non plus : le lien envoyé par courriel prouve la
          // possession de l'adresse, ce qu'un formulaire ici ne ferait pas.
          <Form method="post" className="console-form">
            <input type="hidden" name="intent" value="set-password" />
            <input type="hidden" name="email" value={user.email} />
            <p className="console-muted">
              Setting one gives a second way in, and keeps you out of the provider's
              hands alone. We'll email a link to {user.email}.
            </p>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Sending…" : "Email me a link"}
            </Button>
          </Form>
        )}
      </Section>

      <Section
        title="Connected accounts"
        description="Ways of signing in to this account. Connecting one is deliberate here — a provider never attaches itself to an existing address on its own."
      >
        {forAccounts?.error && <Banner tone="error">{forAccounts.error}</Banner>}
        {forAccounts?.done && <Banner>{forAccounts.done}</Banner>}

        <table className="console-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Connected</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {/* Le mot de passe est une ligne comme une autre : c'est un compte
                `credential` chez Better-Auth, et le montrer ici est ce qui
                rend lisible « il m'en reste une autre » avant de déconnecter. */}
            {hasPassword && (
              <tr>
                <td>Password</td>
                <td className="console-muted">—</td>
                <td />
              </tr>
            )}
            {linked.map((account) => (
              <tr key={account.id}>
                <td>{providerLabel(account.providerId)}</td>
                <td className="console-muted">{day(account.createdAt)}</td>
                <td>
                  {/* ⚠️ Masqué quand c'est la dernière : sans elle, plus
                      personne n'entre. Le serveur refuse de toute façon
                      (`FAILED_TO_UNLINK_LAST_ACCOUNT`) — cacher est un
                      confort, jamais le garde-fou. */}
                  {accounts.length > 1 && (
                    <Form method="post" className="console-row-actions">
                      <input type="hidden" name="intent" value="unlink" />
                      <RowAction
                        danger
                        name="accountId"
                        value={account.id}
                        disabled={busy}
                      >
                        Disconnect
                      </RowAction>
                    </Form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {linkable.length > 0 && (
          <div className="console-actions">
            {linkable.map(({ id, label }) => (
              <Button
                key={id}
                type="button"
                disabled={busy}
                onClick={() =>
                  authClient.linkSocial({
                    provider: id,
                    // Revenir ici, pas à la racine : la ligne qui vient
                    // d'apparaître est la confirmation que ça a marché.
                    callbackURL: window.location.href,
                  })
                }
              >
                Connect {label}
              </Button>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
