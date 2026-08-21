import { createAuthClient } from "better-auth/react";

/**
 * Le client d'authentification, en un seul exemplaire.
 *
 * Les routes de Better-Auth sont **volontairement hors de notre spec
 * OpenAPI** — leur contrat lui appartient (backend `src/app.ts`). Les appeler
 * au `fetch` nu reviendrait à recopier à la main des adresses et des formes de
 * réponse dont rien ne signalerait la dérive à la prochaine montée de version.
 * Le client publié *est* ce contrat.
 *
 * Aucune `baseURL` : par défaut le client vise `/api/auth` sur l'origine
 * courante, et le proxy de développement y renvoie le backend. La console ne
 * porte donc l'adresse du backend nulle part dans son code — elle vit dans
 * `API_PROXY_TARGET`, et rien d'autre n'a à la connaître.
 */
export const authClient = createAuthClient();

/**
 * Où revenir après avoir cliqué le lien de confirmation.
 *
 * Le lien mène au backend, qui redirige ensuite ici. L'adresse doit donc être
 * absolue — à ce moment-là le navigateur n'est plus sur l'origine de la
 * console. Elle est lue à l'exécution plutôt qu'écrite en dur, et le backend
 * ne l'accepte que si elle figure dans son `TRUSTED_ORIGINS`.
 */
export const callbackURL = () => `${window.location.origin}/`;

/** Ce que Better-Auth renvoie en cas de refus, ramené à une phrase affichable. */
export function authErrorMessage(error: { message?: string; code?: string }): string {
  if (error.code === "INVALID_EMAIL_OR_PASSWORD") {
    return "Incorrect email or password.";
  }
  if (error.code === "EMAIL_NOT_VERIFIED") {
    return "Email not confirmed yet. Check your inbox for the confirmation link.";
  }
  if (error.code === "USER_ALREADY_EXISTS") {
    return "An account already exists for that email.";
  }
  // Changing a password: the current one didn't match. Their own wording names
  // no field, which reads as though the new one were at fault.
  if (error.code === "INVALID_PASSWORD") {
    return "Your current password is incorrect.";
  }
  // Unlinking demands a session younger than `freshAge` — a day by default.
  // Their wording says the session isn't fresh, which names a concept nobody
  // outside this file has met.
  if (error.code === "SESSION_NOT_FRESH") {
    return "For this, log out and back in first — it needs a recent login.";
  }
  // Better-Auth refuses to remove the last way into an account. The console
  // hides the action in that case; this covers the tab left open while the
  // other one was removed elsewhere.
  if (error.code === "FAILED_TO_UNLINK_LAST_ACCOUNT") {
    return "That's the only way into this account. Add another before removing it.";
  }
  return error.message ?? "The request was refused.";
}

/**
 * What an OAuth refusal means, from the `?error=` the browser comes back with.
 *
 * These codes arrive in an **address**, not in a response: signing in with a
 * provider leaves the console, and the refusal happens while it has no hand in
 * it. The code is stable; the wording is ours.
 */
export function oauthErrorMessage(code: string): string {
  // The `disableImplicitLinking` refusal — deliberate, and the only one whose
  // way out is a specific act. Left unsaid, one retries the same button
  // forever.
  if (code === "account_not_linked") {
    return "An account already exists for that address. Log in with your password, then link the provider from your account settings.";
  }
  if (code === "email_not_verified") {
    return "That address isn't verified with the provider. Verify it there, or check your inbox — we've sent a confirmation link.";
  }
  if (code === "email_not_found") {
    return "The provider didn't share an email address, and an account needs one.";
  }
  // The remaining codes describe protocol failures — lost state, invalid code,
  // unreachable provider. Translating them one by one would produce sentences
  // nobody can act on.
  return "Logging in with that provider failed. Try again.";
}
