-- `library_schemas` — the organization's schema library (ADR 0018).
--
-- A separate table rather than a nullable `environment_id` on `schemas`: a null
-- scoping column compares to NULL in the policies, so it would match no row —
-- the fail-closed behaviour we want everywhere else. A library row would have
-- been invisible, and working around it would take a second branch inside a
-- security-critical policy.
--
-- It carries no content by construction: a document's foreign key cannot point
-- here. "A document only references a project schema" stops being a rule to
-- enforce.
--
-- ⚠️ `schema_versions` is **shared**, and that is not an economy. The
-- divergence diagnosis asks "is the copy's hash in the library's history?",
-- which only means anything if both name the same version rows. The journal,
-- on the other hand, has to be its own table: a composite foreign key points at
-- one table, and making one that accepts either would mean giving up the
-- constraint — so giving up the fact that a journal line cannot name a phantom
-- schema.

CREATE TABLE "library_schemas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"label" text,
	"definition" jsonb NOT NULL,
	"current_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_schemas_organization_id_name_key" UNIQUE("organization_id","name"),
	CONSTRAINT "library_schemas_organization_id_id_key" UNIQUE("organization_id","id")
);
--> statement-breakpoint

ALTER TABLE "library_schemas" ADD CONSTRAINT "library_schemas_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "library_schemas" ADD CONSTRAINT "library_schemas_current_version_fk" FOREIGN KEY ("organization_id","current_hash") REFERENCES "public"."schema_versions"("organization_id","hash") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "library_schema_history" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "library_schema_history_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"library_schema_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_schema_history_action_check" CHECK (action in ('saved', 'restored'))
);
--> statement-breakpoint

ALTER TABLE "library_schema_history" ADD CONSTRAINT "library_schema_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "library_schema_history" ADD CONSTRAINT "library_schema_history_schema_fk" FOREIGN KEY ("organization_id","library_schema_id") REFERENCES "public"."library_schemas"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "library_schema_history" ADD CONSTRAINT "library_schema_history_version_fk" FOREIGN KEY ("organization_id","hash") REFERENCES "public"."schema_versions"("organization_id","hash") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Better-Auth owns this table, so the key is declared here. SET NULL: the
-- history outlives the accounts.
ALTER TABLE "library_schema_history" ADD CONSTRAINT "library_schema_history_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX "library_schema_history_organization_id_idx" ON "library_schema_history" USING btree ("organization_id","library_schema_id","seq");
--> statement-breakpoint

ALTER TABLE library_schemas ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE library_schemas FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE library_schema_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE library_schema_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY library_schemas_read ON library_schemas
  FOR SELECT
  USING (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY library_schemas_write ON library_schemas
  FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

-- SELECT and INSERT only, like `schema_history`: a journal is append-only, and
-- not writing the policy is what makes that true rather than promised.
CREATE POLICY library_schema_history_read ON library_schema_history
  FOR SELECT
  USING (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY library_schema_history_insert ON library_schema_history
  FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

-- `library.write` — curating the library, distinct from `schema.write`.
--
-- ⚠️ Changing the code catalogue is not enough: system roles are copied into
-- each organization when it is created (ADR 0011), so existing organizations
-- would keep their old rows and only new ones would see the key.
--
-- FORCE has to come off all three: `permissions` has no write policy at all —
-- its contents belong to migrations — and `roles` / `role_permissions` are
-- scoped by organization, which a migration does not have.
ALTER TABLE permissions NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE role_permissions NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

INSERT INTO permissions (key, description) VALUES
  ('library.write', 'Curate the organization''s schema library')
;
--> statement-breakpoint

-- Owner and admin, as ADR 0018 decided. The real risk is smaller than it
-- looks: copies are independent, so editing the library breaks nothing that
-- exists. The key is separate because that default will probably be revisited.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'library.write'
FROM roles r
WHERE r.is_system
  AND r.scope = 'organization'
  AND r.name IN ('owner', 'admin')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ⚠️ Custom roles get nothing, on purpose. No existing key implied this one —
-- `schema.write` deliberately does not, which is the whole point of ADR 0018 —
-- so handing it out would be granting a power nobody asked for. Migration 0027
-- did the opposite because there the key was *split out* of one that already
-- carried the ability.

ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
