-- Migration de données sous RLS : `FORCE ROW LEVEL SECURITY` soumet même le
-- propriétaire aux policies, donc un remplissage échouerait — silencieusement,
-- en ne touchant aucune ligne. On lève FORCE le temps de l'opération.
--
-- Supprimer les policies ne conviendrait pas : une table sans policy est
-- fermée, pas ouverte.
ALTER TABLE environments NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE projects NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "environments" e SET "organization_id" = p."organization_id"
  FROM "projects" p WHERE p."id" = e."project_id";--> statement-breakpoint
ALTER TABLE "environments" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "environments_organization_id_idx" ON "environments" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE environments FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE projects FORCE ROW LEVEL SECURITY;