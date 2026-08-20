import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { app } from "../app.ts";
import { auth } from "../auth.ts";
import { withContext } from "../db/client.ts";

/**
 * Utilitaires de test. Rien ici n'est utilisé par le serveur.
 *
 * Depuis que la confirmation d'adresse est exigée, s'inscrire ne suffit plus
 * à obtenir une session : les tests doivent marquer l'adresse comme
 * confirmée, ce que ferait un clic sur le lien reçu.
 */
export type TestUser = { id: string; email: string; cookie: string };

/** Ce que produirait un clic sur le lien de confirmation. */
async function markVerified(email: string) {
  await withContext({}, (tx) =>
    tx.execute(sql`update "user" set "emailVerified" = true where email = ${email}`),
  );
}

/** Crée un compte confirmé et ouvre une session. */
export async function createVerifiedUser(prefix: string): Promise<TestUser> {
  const email = `${prefix}-${randomUUID()}@skafform.test`;
  const password = "MotDePasseTest123!";

  const created = await auth.api.signUpEmail({
    body: { email, password, name: prefix },
  });
  await markVerified(email);

  const response = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = response.headers.get("set-cookie");
  if (!cookie) {
    throw new Error(`connexion impossible pour ${email}`);
  }

  return { id: created.user.id, email, cookie };
}
