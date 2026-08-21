import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { envSchema } from "./env.ts";

const valid = {
  PLATFORM_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5433/db",
  DATABASE_MIGRATION_URL: "postgresql://o:p@127.0.0.1:5433/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  PLATFORM_MAIL_FROM: "noreply@example.test",
};

describe("envSchema", () => {
  it("accepts a complete environment", () => {
    const result = envSchema.safeParse(valid);
    assert.equal(result.success, true);
  });

  it("defaults NODE_ENV and PORT when absent", () => {
    const result = envSchema.parse(valid);
    assert.equal(result.NODE_ENV, "development");
    assert.equal(result.PORT, 3000);
  });

  it("coerces PORT from its string form", () => {
    const result = envSchema.parse({ ...valid, PORT: "8080" });
    assert.equal(result.PORT, 8080);
  });

  it("rejects a missing database URL", () => {
    const { DATABASE_URL, ...withoutDb } = valid;
    const result = envSchema.safeParse(withoutDb);
    assert.equal(result.success, false);
  });

  it("rejects a secret shorter than 32 characters", () => {
    const result = envSchema.safeParse({
      ...valid,
      BETTER_AUTH_SECRET: "too-short",
    });
    assert.equal(result.success, false);
  });

  it("rejects a malformed URL", () => {
    const result = envSchema.safeParse({ ...valid, PLATFORM_URL: "not-a-url" });
    assert.equal(result.success, false);
  });

  it("allows a missing Resend key outside production", () => {
    const result = envSchema.safeParse({ ...valid, NODE_ENV: "development" });
    assert.equal(result.success, true, "un email perdu en local est sans conséquence");
  });

  it("allows GitHub credentials to be absent", () => {
    const result = envSchema.safeParse(valid);
    assert.equal(result.success, true, "la CI n'a pas d'application OAuth");
  });

  it("accepts GitHub credentials as a pair", () => {
    const result = envSchema.safeParse({
      ...valid,
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "secret",
    });
    assert.equal(result.success, true);
  });

  it("rejects a GitHub id without its secret", () => {
    const result = envSchema.safeParse({ ...valid, GITHUB_CLIENT_ID: "id" });
    assert.equal(
      result.success,
      false,
      "une moitié de configuration se découvrirait au premier clic",
    );
  });

  it("rejects a GitHub secret without its id", () => {
    const result = envSchema.safeParse({ ...valid, GITHUB_CLIENT_SECRET: "secret" });
    assert.equal(result.success, false);
  });

  it("requires the Resend key in production", () => {
    const result = envSchema.safeParse({ ...valid, NODE_ENV: "production" });
    assert.equal(
      result.success,
      false,
      "en production, le repli console ferait disparaître les emails",
    );
  });
});
