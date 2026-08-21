import { Form, Link, redirect, useNavigation } from "react-router";
import { ApiError, api, apiErrorMessage } from "../lib/api";
import { authClient } from "../lib/auth";
import { Banner, Button } from "../ui/controls";
import type { Route } from "./+types/accept-invitation";

type InvitationDescription = {
  email: string;
  organizationName: string;
  roleName: string;
  /** Décide si on propose la connexion ou l'inscription — jamais les deux. */
  hasAccount: boolean;
};

/**
 * Où mène le lien envoyé par email. Hors de toute coque, comme les autres
 * écrans d'entrée : celle-ci se construit autour d'une organization, or le
 * porteur du lien n'en a peut-être aucune, et n'a pas forcément de session.
 *
 * `describeInvitation` ne demande pas de session (le jeton est son propre
 * laissez-passer) — l'écran doit donc afficher quelque chose d'utile même
 * déconnecté, plutôt que d'exiger une session avant de savoir de quoi il
 * s'agit.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const { data: session } = await authClient.getSession();

  if (!token) {
    return {
      token,
      session,
      invitation: null,
      error: "This link is missing its token.",
    };
  }

  try {
    const invitation = await api<InvitationDescription>(`/invitations/${token}`);
    return { token, session, invitation, error: null };
  } catch (error) {
    if (error instanceof ApiError) {
      return { token, session, invitation: null, error: apiErrorMessage(error) };
    }
    throw error;
  }
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const token = String(form.get("token"));

  try {
    await api(`/invitations/${token}/accept`, { method: "POST" });
    // La racine choisit où aller ensuite — c'est déjà son rôle pour toute
    // organization. Une invitation de projet n'en crée aucune : la personne y
    // atterrit sans en avoir, ce que la console ne sait pas encore présenter
    // (docs/backlog #0008 touche à ce même angle mort).
    return redirect("/");
  } catch (error) {
    if (error instanceof ApiError) return { error: apiErrorMessage(error) };
    throw error;
  }
}

export default function AcceptInvitation({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { token, session, invitation, error } = loaderData;
  const busy = useNavigation().state !== "idle";

  return (
    <div className="console console-centered">
      <div className="console-panel">
        <h1>Join organization</h1>

        {(actionData?.error ?? error) && (
          <Banner tone="error">{actionData?.error ?? error}</Banner>
        )}

        {invitation && (
          <>
            <p>
              You've been invited to join <strong>{invitation.organizationName}</strong>{" "}
              as <strong>{invitation.roleName}</strong>.
            </p>

            {!session ? (
              /* Un seul chemin, celui qui correspond : le serveur sait déjà si
                 l'adresse a un compte, la personne n'a pas à le deviner —
                 sinon elle tombe sur « un compte existe déjà » ou « adresse ou
                 mot de passe incorrect », deux erreurs qui ne lui apprennent
                 rien d'utile. */
              <>
                <p className="console-muted">
                  {invitation.hasAccount
                    ? "Sign in to accept."
                    : "Create your account to accept."}{" "}
                  This invitation is for <strong>{invitation.email}</strong>.
                </p>
                <Link
                  className="console-button console-button--primary console-button--block"
                  to={`${invitation.hasAccount ? "/login" : "/signup"}?email=${encodeURIComponent(invitation.email)}`}
                >
                  {invitation.hasAccount ? "Sign in" : "Create an account"}
                </Link>
              </>
            ) : session.user.email.toLowerCase() !== invitation.email.toLowerCase() ? (
              <Banner tone="error">
                You're signed in as {session.user.email}, but this invitation is for{" "}
                {invitation.email}. Sign out and try again with that address.
              </Banner>
            ) : (
              <Form method="post">
                <input type="hidden" name="token" value={token} />
                <Button type="submit" variant="primary" block disabled={busy}>
                  {busy ? "Joining…" : "Accept and join"}
                </Button>
              </Form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
