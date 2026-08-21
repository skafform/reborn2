import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { authClient, authErrorMessage } from "../lib/auth";
import { Banner, Button, Field } from "../ui/controls";
import type { Route } from "./+types/reset-password";

/** Where the link in the email comes back to — this screen, with a token. */
export const resetRedirectTo = () => `${window.location.origin}/reset-password`;

/**
 * Les deux moitiés d'un même geste, sur un seul écran.
 *
 * Sans jeton : demander le lien. Avec un jeton : choisir le mot de passe. Ce
 * sont deux formulaires, pas deux sujets — et l'adresse ne change pas entre
 * les deux, puisque c'est le lien du courriel qui ramène ici.
 *
 * ⚠️ **Sert aussi à en définir un.** `resetPassword` **crée** le compte
 * credential s'il n'y en a pas — c'est donc le chemin d'un compte arrivé par
 * OAuth seul, pour qui `setPassword` de Better-Auth est hors d'atteinte
 * (`serverOnly`). Voir docs/architecture/auth.md.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const token = form.get("token");

  if (typeof token === "string" && token !== "") {
    const { error } = await authClient.resetPassword({
      newPassword: String(form.get("newPassword")),
      token,
    });
    if (error) return { error: authErrorMessage(error) };
    return { done: "Password set. You can log in with it now." };
  }

  const { error } = await authClient.requestPasswordReset({
    email: String(form.get("email")),
    redirectTo: resetRedirectTo(),
  });
  if (error) return { error: authErrorMessage(error) };
  // ⚠️ Le même message qu'une adresse inconnue reçoit — le serveur ne dit pas
  // si le compte existe, et l'écran ne doit pas le dire non plus. Sinon ce
  // formulaire devient un moyen d'énumérer les comptes.
  return { done: "If that address has an account, a link is on its way." };
}

export default function ResetPassword({ actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const params = useSearchParams()[0];
  const token = params.get("token");
  // Le backend renvoie ici avec `?error=INVALID_TOKEN` quand le lien a expiré
  // ou a déjà servi. Sans ce cas, l'écran demanderait un mot de passe qu'il
  // ne pourrait pas enregistrer.
  const invalidToken = params.get("error") !== null;

  return (
    <div className="console console-centered">
      <div className="console-panel">
        <h1>{token ? "Choose a password" : "Reset your password"}</h1>

        {actionData?.error && <Banner tone="error">{actionData.error}</Banner>}
        {actionData?.done && <Banner>{actionData.done}</Banner>}
        {invalidToken && (
          <Banner tone="error">
            That link has expired or was already used. Ask for another one below.
          </Banner>
        )}

        {token && !invalidToken ? (
          <Form method="post">
            <input type="hidden" name="token" value={token} />
            <Field label="New password">
              <input
                className="console-input"
                name="newPassword"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </Field>

            <Button type="submit" variant="primary" block disabled={busy}>
              {busy ? "Saving…" : "Save password"}
            </Button>
          </Form>
        ) : (
          <Form method="post">
            <p className="console-muted">
              Enter your address and we'll send you a link to choose a new password.
            </p>
            <Field label="Email">
              <input
                className="console-input"
                name="email"
                type="email"
                required
                autoComplete="email"
              />
            </Field>

            <Button type="submit" variant="primary" block disabled={busy}>
              {busy ? "Sending…" : "Send the link"}
            </Button>
          </Form>
        )}

        <p className="console-form-footer">
          <Link to="/login">Back to log in</Link>
        </p>
      </div>
    </div>
  );
}
