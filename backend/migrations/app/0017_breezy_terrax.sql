-- Migration de données sous RLS : lever FORCE le temps du remplissage, sinon
-- il ne toucherait aucune ligne — silencieusement.
ALTER TABLE api_keys NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE environments NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "organization_id" uuid;
--> statement-breakpoint
UPDATE "api_keys" k SET "organization_id" = e."organization_id"
  FROM "environments" e WHERE e."id" = k."environment_id";
--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_id_organization_id_key" UNIQUE("id","organization_id");
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_environment_fk" FOREIGN KEY ("environment_id","organization_id") REFERENCES "public"."environments"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "api_keys_organization_id_idx" ON "api_keys" USING btree ("organization_id");
--> statement-breakpoint
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE environments FORCE ROW LEVEL SECURITY;
