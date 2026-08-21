import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { api } from "../lib/api";
import { AuthProvidersSchema } from "../lib/api-contract";
import { authClient, authErrorMessage, oauthErrorMessage } from "../lib/auth";
import { Banner, Button, Field } from "../ui/controls";
import { SocialSignIn } from "../ui/social-sign-in";
import type { Route } from "./+types/login";

/**
 * Quels boutons afficher. Le serveur le dit — les identifiants OAuth sont
 * facultatifs par déploiement, et deviner produirait soit un bouton qui
 * échoue, soit un bouton absent qui marcherait.
 */
export async function clientLoader() {
  return await api("/auth-providers", AuthProvidersSchema);
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();

  const { error } = await authClient.signIn.email({
    email: String(form.get("email")),
    password: String(form.get("password")),
  });

  if (error) return { error: authErrorMessage(error) };
  return redirect("/");
}

export default function Login({ actionData, loaderData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const params = useSearchParams()[0];
  // Rempli par le lien d'une invitation, jamais imposé : l'adresse reste
  // modifiable, pour la personne qui préfère se connecter avec une autre.
  const prefilledEmail = params.get("email") ?? undefined;
  // Le refus d'un fournisseur revient ici, dans l'adresse : la connexion
  // OAuth quitte la console, donc il n'y a pas de réponse à attraper.
  const oauthError = params.get("error");

  return (
    <div className="console console-centered">
      <div className="console-panel">
        <h1>Sign in</h1>

        {actionData?.error && <Banner tone="error">{actionData.error}</Banner>}
        {oauthError && <Banner tone="error">{oauthErrorMessage(oauthError)}</Banner>}

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

        <SocialSignIn providers={loaderData.providers} disabled={busy} />

        <p className="console-form-footer">
          <Link to="/signup">Create an account</Link>
          <Link to="/reset-password">Forgot your password?</Link>
        </p>
      </div>
    </div>
  );
}
