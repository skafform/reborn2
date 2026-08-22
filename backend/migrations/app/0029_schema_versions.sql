-- Schema versioning, content-addressed (ADR 0016).
--
-- `schema_versions` is immutable, deduplicated content — the *blob*.
-- `schema_history` is a per-schema, append-only journal — the *commit*.
-- `schemas.current_hash` points at the current state.
--
-- ⚠️ The statement order below is NOT what drizzle-kit generated. It emitted
-- `schema_history`'s composite foreign key before the unique constraint on
-- `schemas (id, organization_id)` that the key targets — the invalid ordering
-- this project has already been bitten by (CLAUDE.md, "pièges à ne pas
-- redécouvrir"). Dependencies are created before their dependants here.
--
-- ⚠️ `current_hash` is added `NOT NULL` with no default and no backfill. That
-- is only possible because no schema exists anywhere yet — verified, not
-- assumed. An environment holding rows will fail loudly on this statement,
-- which is the correct outcome: there is no fingerprint to invent for them.
--
-- No GRANT here: the default privileges set at bootstrap give the application
-- role what it needs on every table the owner creates (scripts/bootstrap-db.ts).

CREATE TABLE "schema_versions" (
	"organization_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"name" text NOT NULL,
	"label" text,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schema_versions_organization_id_hash_pk" PRIMARY KEY("organization_id","hash")
);
--> statement-breakpoint

-- ⚠️ CASCADE, where `schemas` uses RESTRICT. A version has no other parent to
-- carry it away, so RESTRICT would make deleting an organization impossible —
-- the defect docs/backlog #0010 already recorded once.
ALTER TABLE "schema_versions" ADD CONSTRAINT "schema_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "schemas" ADD COLUMN "current_hash" text NOT NULL;
--> statement-breakpoint

-- The target of the journal's composite foreign key. It has to exist before
-- anything references it.
ALTER TABLE "schemas" ADD CONSTRAINT "schemas_id_organization_id_key" UNIQUE("id","organization_id");
--> statement-breakpoint

-- "the current pointer always names a real version", as a property of the
-- shape rather than a discipline.
ALTER TABLE "schemas" ADD CONSTRAINT "schemas_current_version_fk" FOREIGN KEY ("organization_id","current_hash") REFERENCES "public"."schema_versions"("organization_id","hash") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- ⚠️ `seq` is the order of the journal, and the only thing that can carry it:
-- `created_at` is `now()`, the transaction start time, which two concurrent
-- saves can share. It is never exposed — a global sequence would state the
-- platform's write volume.
CREATE TABLE "schema_history" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "schema_history_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"schema_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schema_history_action_check" CHECK (action in ('saved', 'restored'))
);
--> statement-breakpoint

ALTER TABLE "schema_history" ADD CONSTRAINT "schema_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "schema_history" ADD CONSTRAINT "schema_history_schema_fk" FOREIGN KEY ("schema_id","organization_id") REFERENCES "public"."schemas"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- ⚠️ A journal line can never name a version that does not exist.
ALTER TABLE "schema_history" ADD CONSTRAINT "schema_history_version_fk" FOREIGN KEY ("organization_id","hash") REFERENCES "public"."schema_versions"("organization_id","hash") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Better-Auth owns this table, so the key is declared here rather than in the
-- Drizzle schema. SET NULL: the history outlives the accounts.
ALTER TABLE "schema_history" ADD CONSTRAINT "schema_history_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX "schema_history_organization_id_idx" ON "schema_history" USING btree ("organization_id","schema_id","seq");
--> statement-breakpoint

ALTER TABLE schema_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE schema_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE schema_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE schema_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- One condition, on the scoping column each table carries itself. No fallback:
-- `app_current_organization_id()` is NULL outside a context, so no rows —
-- fail-closed.
--
-- ⚠️ **SELECT and INSERT only, deliberately.** Neither table has an UPDATE or
-- a DELETE policy, because a version is immutable and a journal is append-only.
-- Cascading deletes still work: referential integrity actions bypass row
-- security, which is what lets an organization be removed with its history.
CREATE POLICY schema_versions_read ON schema_versions
  FOR SELECT
  USING (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY schema_versions_insert ON schema_versions
  FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY schema_history_read ON schema_history
  FOR SELECT
  USING (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY schema_history_insert ON schema_history
  FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id());
