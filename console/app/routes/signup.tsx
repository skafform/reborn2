import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { authClient, authErrorMessage, callbackURL } from "../lib/auth";
import { Banner, Button, Field } from "../ui/controls";
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
  // Rempli par le lien d'une invitation, jamais imposé : l'adresse reste
  // modifiable, pour la personne qui préfère s'inscrire avec une autre.
  const prefilledEmail = useSearchParams()[0].get("email") ?? undefined;

  return (
    <div className="console console-centered">
      <div className="console-panel">
        <h1>Create an account</h1>

        {actionData?.error && <Banner tone="error">{actionData.error}</Banner>}

        <Form method="post">
          <Field label="Name">
            <input className="console-input" name="name" required autoComplete="name" />
          </Field>

          <Field label="Email">
            <input
              className="console-input"
              name="email"
              type="email"
              required
              autoComplete="email"
              defaultValue={prefilledEmail}
            />
          </Field>

          <Field label="Password">
            <input
              className="console-input"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>

          <Button type="submit" variant="primary" block disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </Button>
        </Form>

        <p className="console-form-footer">
          <Link to="/login">I already have an account</Link>
        </p>
      </div>
    </div>
  );
}
