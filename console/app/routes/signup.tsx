import { Form, Link, redirect, useNavigation } from "react-router";
import { authClient, authErrorMessage, callbackURL } from "../lib/auth";
import type { Route } from "./+types/signup";

/**
 * Créer un compte.
 *
 * L'inscription **n'ouvre pas de session** : le backend impose la confirmation
 * d'adresse (`requireEmailVerification`), sans quoi n'importe qui créerait un
 * compte avec l'adresse d'un tiers pour recevoir ses invitations. On repart
 * donc vers l'écran d'attente, pas vers l'accueil.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email"));

  const { error } = await authClient.signUp.email({
    email,
    password: String(form.get("password")),
    name: String(form.get("name")),
    callbackURL: callbackURL(),
  });

  if (error) return { error: authErrorMessage(error) };
  return redirect(`/verify-email?email=${encodeURIComponent(email)}`);
}

export default function Signup({ actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";

  return (
    <div className="console console-centered">
      <div className="console-panel">
        <h1>Créer un compte</h1>

        {actionData?.error && (
          <p className="console-banner console-banner--error">{actionData.error}</p>
        )}

        <Form method="post">
          <label className="console-field">
            <span className="console-label">Nom</span>
            <input className="console-input" name="name" required autoComplete="name" />
          </label>

          <label className="console-field">
            <span className="console-label">Adresse</span>
            <input
              className="console-input"
              name="email"
              type="email"
              required
              autoComplete="email"
            />
          </label>

          <label className="console-field">
            <span className="console-label">Mot de passe</span>
            <input
              className="console-input"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>

          <button
            className="console-button console-button--primary console-button--block"
            type="submit"
            disabled={busy}
          >
            {busy ? "Création…" : "Créer le compte"}
          </button>
        </Form>

        <p className="console-form-footer">
          <Link className="console-text-link" to="/login">
            J'ai déjà un compte
          </Link>
        </p>
      </div>
    </div>
  );
}
