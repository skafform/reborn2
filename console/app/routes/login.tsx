import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { authClient, authErrorMessage } from "../lib/auth";
import { Banner, Button, Field } from "../ui/controls";
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
  // Rempli par le lien d'une invitation, jamais imposé : l'adresse reste
  // modifiable, pour la personne qui préfère se connecter avec une autre.
  const prefilledEmail = useSearchParams()[0].get("email") ?? undefined;

  return (
    <div className="console console-centered">
      <div className="console-panel">
        <h1>Sign in</h1>

        {actionData?.error && <Banner tone="error">{actionData.error}</Banner>}

        <Form method="post">
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
              autoComplete="current-password"
            />
          </Field>

          <Button type="submit" variant="primary" block disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </Form>

        <p className="console-form-footer">
          <Link to="/signup">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
