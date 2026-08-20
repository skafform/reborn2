import { Form, Link, redirect, useNavigation } from "react-router";
import { authClient, authErrorMessage } from "../lib/auth";
import type { Route } from "./+types/login";

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();

  const { error } = await authClient.signIn.email({
    email: String(form.get("email")),
    password: String(form.get("password")),
  });

  if (error) return { error: authErrorMessage(error) };
  return redirect("/");
}

export default function Login({ actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";

  return (
    <div className="console console-centered">
      <div className="console-panel">
        <h1>Se connecter</h1>

        {actionData?.error && (
          <p className="console-banner console-banner--error">{actionData.error}</p>
        )}

        <Form method="post">
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
              autoComplete="current-password"
            />
          </label>

          <button
            className="console-button console-button--primary console-button--block"
            type="submit"
            disabled={busy}
          >
            {busy ? "Connexion…" : "Se connecter"}
          </button>
        </Form>

        <p className="console-form-footer">
          <Link className="console-text-link" to="/signup">
            Créer un compte
          </Link>
        </p>
      </div>
    </div>
  );
}
