-- `schemas.copied_from` — where a content type came from, if it was copied out
-- of the organization's library (ADR 0018).
--
-- ⚠️ **The only link in the model that crosses two levels of scoping.**
-- `schemas` is scoped by environment, `library_schemas` by organization, so the
-- key is composite on `(organization_id, copied_from)` — and that is meant to
-- read as deliberate rather than accidental.
--
-- Matching by name instead would have broken the first time anyone renamed a
-- schema, and "which projects run a modified version of this?" is exactly the
-- question that has to stay reliable.

ALTER TABLE "schemas" ADD COLUMN "copied_from" uuid;
--> statement-breakpoint

-- ⚠️ **The column list on SET NULL is load-bearing, and hand-written.**
-- drizzle-kit emitted `ON DELETE no action` here, because Drizzle cannot
-- express the column-list form (PostgreSQL 15+). A bare `SET NULL` would be
-- worse than no action: it would null `organization_id` too — which is NOT
-- NULL — so deleting a library entry would fail outright instead of leaving its
-- copies alive without provenance, which is what ADR 0018 asks for.
--
-- Verified against this server (17.10) before being written down.
--
-- The Drizzle schema still declares the constraint, with the imprecise clause,
-- so the snapshot knows about it and a later generation does not re-emit it —
-- the drift migration 0024 caused.
ALTER TABLE "schemas" ADD CONSTRAINT "schemas_copied_from_fk"
  FOREIGN KEY ("organization_id", "copied_from")
  REFERENCES "public"."library_schemas" ("organization_id", "id")
  ON DELETE SET NULL ("copied_from");
--> statement-breakpoint

-- Scoping column first, as everywhere: this index answers "which copies came
-- from this library entry?", the question the whole column exists for.
CREATE INDEX "schemas_copied_from_idx" ON "schemas" USING btree ("organization_id","copied_from");
