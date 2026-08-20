import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { authClient, authErrorMessage, callbackURL } from "../lib/auth";
import type { Route } from "./+types/verify-email";

/**
 * Renvoyer le lien de confirmation.
 *
 * Sans ce recours, un courriel perdu ou filtré laisserait un compte
 * inutilisable **et** son adresse prise — impossible de se réinscrire, et
 * impossible de se connecter. Ce n'est pas un confort.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();

  const { error } = await authClient.sendVerificationEmail({
    email: String(form.get("email")),
    callbackURL: callbackURL(),
  });

  if (error) return { error: authErrorMessage(error) };
  return { sent: true };
}

export default function VerifyEmail({ actionData }: Route.ComponentProps) {
  const email = useSearchParams()[0].get("email") ?? "";
  const busy = useNavigation().state !== "idle";

  return (
    <div className="console console-centered">
      <div className="console-panel">
        <h1>Confirmez votre adresse</h1>

        <p>
          Un lien vient d'être envoyé{email ? " à " : ""}
          {email && <strong>{email}</strong>}. Il ouvre la session — inutile de retaper
          le mot de passe.
        </p>

        {actionData && "error" in actionData && (
          <p className="console-banner console-banner--error">{actionData.error}</p>
        )}
        {actionData && "sent" in actionData && (
          <p className="console-banner">Lien renvoyé.</p>
        )}

        <Form method="post">
          <input type="hidden" name="email" value={email} />
          <button
            className="console-button console-button--block"
            type="submit"
            disabled={busy || !email}
          >
            {busy ? "Envoi…" : "Renvoyer le lien"}
          </button>
        </Form>

        <p className="console-form-footer">
          <Link className="console-text-link" to="/login">
            Retour à la connexion
          </Link>
        </p>
      </div>
    </div>
  );
}
