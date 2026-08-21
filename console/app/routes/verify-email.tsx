import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { authClient, authErrorMessage, callbackURL } from "../lib/auth";
import { Banner, Button } from "../ui/controls";
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
        <h1>Confirm your email</h1>

        <p>
          A link was just sent{email ? " to " : ""}
          {email && <strong>{email}</strong>}. It signs you in — no need to type your
          password again.
        </p>

        {actionData && "error" in actionData && (
          <Banner tone="error">{actionData.error}</Banner>
        )}
        {actionData && "sent" in actionData && <Banner>Link resent.</Banner>}

        <Form method="post">
          <input type="hidden" name="email" value={email} />
          <Button type="submit" block disabled={busy || !email}>
            {busy ? "Sending…" : "Resend link"}
          </Button>
        </Form>

        <p className="console-form-footer">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
