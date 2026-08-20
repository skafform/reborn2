import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { app } from "./app.ts";
import { env } from "./config/env.ts";

/**
 * Test d'intégration : il touche la vraie base locale. Il rend rejouable la
 * vérification qui n'existait qu'en curl manuel.
 */
const EMAIL = "auth-flow@skafform.test";
const PASSWORD = "MotDePasseTest123!";

const pool = new Pool({ connectionString: env.DATABASE_MIGRATION_URL });

async function removeTestUser() {
  await pool.query('DELETE FROM "user" WHERE email = $1', [EMAIL]);
}

/** Ce que produirait un clic sur le lien de confirmation. */
async function markVerified(email: string) {
  await pool.query('UPDATE "user" SET "emailVerified" = true WHERE email = $1', [
    email,
  ]);
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("email + password flow", () => {
  before(removeTestUser);
  after(async () => {
    await removeTestUser();
    await pool.end();
  });

  it("refuses to sign in before the address is confirmed", async () => {
    const signUp = await post("/api/auth/sign-up/email", {
      email: EMAIL,
      password: PASSWORD,
      name: "Auth Flow",
    });
    assert.equal(signUp.status, 200, "the account is created");

    const tooEarly = await post("/api/auth/sign-in/email", {
      email: EMAIL,
      password: PASSWORD,
    });
    assert.notEqual(
      tooEarly.status,
      200,
      "an unconfirmed address must not open a session",
    );
  });

  it("signs in once confirmed, then resolves the session", async () => {
    await markVerified(EMAIL);

    const signIn = await post("/api/auth/sign-in/email", {
      email: EMAIL,
      password: PASSWORD,
    });
    assert.equal(signIn.status, 200);

    const cookie = signIn.headers.get("set-cookie");
    assert.ok(cookie, "sign-in must set a session cookie");

    const session = await app.request("/api/auth/get-session", {
      headers: { cookie },
    });
    assert.equal(session.status, 200);

    const payload = (await session.json()) as { user: { email: string } } | null;
    assert.equal(payload?.user.email, EMAIL);
  });

  it("rejects a wrong password", async () => {
    const res = await post("/api/auth/sign-in/email", {
      email: EMAIL,
      password: "WrongPassword123!",
    });
    assert.equal(res.status, 401);
  });

  it("returns no session without a cookie", async () => {
    const res = await app.request("/api/auth/get-session");
    assert.equal(await res.json(), null);
  });
});
