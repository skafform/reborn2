import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { envSchema } from "./env.ts";

const valid = {
  PLATFORM_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5433/db",
  DATABASE_MIGRATION_URL: "postgresql://o:p@127.0.0.1:5433/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
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
});
