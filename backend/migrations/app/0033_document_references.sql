-- `document_references` — the derived index of references between documents
-- (ADR 0020). It is born **with** the documents it indexes, never before: a
-- reference table with nothing to index is the exact mistake a previous
-- project made, created and never populated.
--
-- ⚠️ Derived, never authoritative. The value that counts is the UUID inside
-- `documents.data`; this table is rebuildable by re-scanning documents, which
-- is what makes the pattern low-risk — a synchronisation bug is repairable
-- debt, never lost data.
--
-- ⚠️ Statement order is NOT drizzle-kit's, for the **fourth** time (0029,
-- 0031, 0032, 0033): it emitted both composite keys before the unique
-- constraint they target.

-- The target first.
ALTER TABLE "documents" ADD CONSTRAINT "documents_id_environment_id_key" UNIQUE("id","environment_id");
--> statement-breakpoint

CREATE TABLE "document_references" (
	"organization_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"source_document_id" uuid NOT NULL,
	"target_document_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	CONSTRAINT "document_references_organization_id_source_document_id_field_name_pk" PRIMARY KEY("organization_id","source_document_id","field_name")
);
--> statement-breakpoint

ALTER TABLE "document_references" ADD CONSTRAINT "document_references_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- ⚠️ Both composite keys carry the **same** `environment_id` in one row, so a
-- reference cannot cross environments. Forbidden by shape, not by discipline —
-- the `api_keys` and `schemas` mould.
ALTER TABLE "document_references" ADD CONSTRAINT "document_references_source_fk" FOREIGN KEY ("source_document_id","environment_id") REFERENCES "public"."documents"("id","environment_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- ⚠️ CASCADE on the target side too, and the refusal is the application's —
-- the reverse of what ADR 0020 sketched, for a reason found while building it.
-- A RESTRICT here makes deleting a **project** impossible: the cascade reaches
-- the documents and the first referenced one blocks its own removal. Deleting
-- a container has to take its contents, references included.
--
-- What the decision protected — nothing is deleted while it holds something up
-- — is intact and better placed: `deleteDocument` refuses while **naming the
-- referrers**, which a constraint could never have done. The key guarantees
-- what is its own: no index row outlives the document it names. And no
-- dangling reference can come of it — a document dies either through
-- `deleteDocument`, which refuses, or with its whole environment, in which
-- case the source goes with the target.
ALTER TABLE "document_references" ADD CONSTRAINT "document_references_target_fk" FOREIGN KEY ("target_document_id","environment_id") REFERENCES "public"."documents"("id","environment_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- "What points at this document?" — the question the whole table exists for,
-- asked on every delete and every unpublish.
CREATE INDEX "document_references_target_idx" ON "document_references" USING btree ("organization_id","target_document_id");
--> statement-breakpoint

ALTER TABLE document_references ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE document_references FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY document_references_read ON document_references
  FOR SELECT
  USING (organization_id = app_current_organization_id());
--> statement-breakpoint

-- ⚠️ `FOR ALL`, unlike the two version stores. This table is **rewritten** on
-- every document write — its rows are deleted and re-inserted from `data` in
-- the same transaction — so append-only would be exactly wrong here.
CREATE POLICY document_references_write ON document_references
  FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
