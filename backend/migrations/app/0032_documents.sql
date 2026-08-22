-- `documents` and `document_versions` — one row, two pointers (ADR 0022).
--
-- The publication state is **derived**, never stored: draft when
-- `published_hash` is null, published when it equals `current_hash`, changed
-- otherwise. A `status` column cannot express the third, which is the central
-- case of editorial work — a live document carrying pending edits.
--
-- ⚠️ The statement order is NOT drizzle-kit's. It emitted `documents_schema_fk`
-- before the unique constraint on `schemas (id, environment_id)` that the key
-- targets — the same invalid ordering as migrations 0029 and 0031. Third time,
-- and it is listed in etat.md for that reason.

-- The target first. Without it, a document in one environment could claim a
-- content type from another, and the delivery API would serve a document
-- validated against a schema its environment does not contain.
ALTER TABLE "schemas" ADD CONSTRAINT "schemas_id_environment_id_key" UNIQUE("id","environment_id");
--> statement-breakpoint

-- ⚠️ A separate store from `schema_versions`, despite the identical shape and
-- the shared fingerprint. What differs is lifetime: a schema version is held
-- forever by an append-only journal, a document version only by two pointers
-- and dies when they let go. In one table the document cleanup would collide
-- with the schema journal's keys — so never run, in silence.
CREATE TABLE "document_versions" (
	"organization_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_organization_id_hash_pk" PRIMARY KEY("organization_id","hash")
);
--> statement-breakpoint

ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"schema_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"current_hash" text NOT NULL,
	"published_hash" text,
	"locale" text DEFAULT 'fr' NOT NULL,
	"translation_group_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "documents" ADD CONSTRAINT "documents_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_environment_fk" FOREIGN KEY ("environment_id","organization_id") REFERENCES "public"."environments"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- ⚠️ RESTRICT, deliberately: deleting a content type that still holds entries
-- is refused by counting what remains — the rule everywhere else here.
ALTER TABLE "documents" ADD CONSTRAINT "documents_schema_fk" FOREIGN KEY ("schema_id","environment_id") REFERENCES "public"."schemas"("id","environment_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

-- ⚠️ Both pointers carry a key: "a pointer always names a real version" is a
-- property of the shape. It is also what refuses to delete a version another
-- document has just taken up — the lost race of ADR 0022, which the save path
-- swallows as the success it is.
ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_fk" FOREIGN KEY ("organization_id","current_hash") REFERENCES "public"."document_versions"("organization_id","hash") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_published_version_fk" FOREIGN KEY ("organization_id","published_hash") REFERENCES "public"."document_versions"("organization_id","hash") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "documents_organization_id_idx" ON "documents" USING btree ("organization_id","environment_id","schema_id");
--> statement-breakpoint

-- The two indexes the cleanup interrogates. "Does any pointer still name this
-- hash?" is asked on every save; without them it would scan the
-- organization's documents on every keystroke's worth of saving.
CREATE INDEX "documents_current_hash_idx" ON "documents" USING btree ("organization_id","current_hash");
--> statement-breakpoint
CREATE INDEX "documents_published_hash_idx" ON "documents" USING btree ("organization_id","published_hash") WHERE published_hash is not null;
--> statement-breakpoint

CREATE INDEX "documents_translation_group_idx" ON "documents" USING btree ("organization_id","translation_group_id");
--> statement-breakpoint

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY document_versions_read ON document_versions
  FOR SELECT
  USING (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY document_versions_insert ON document_versions
  FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

-- ⚠️ **A DELETE policy, where `schema_versions` has none** — the deliberate
-- departure from that pattern. A document version stays **immutable** (there
-- is still no UPDATE policy) but is **deletable once nothing names it**: the
-- synchronous cleanup, without which the store would grow unbounded from day
-- one, content changing orders of magnitude more often than schemas.
CREATE POLICY document_versions_delete ON document_versions
  FOR DELETE
  USING (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY documents_read ON documents
  FOR SELECT
  USING (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY documents_write ON documents
  FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
