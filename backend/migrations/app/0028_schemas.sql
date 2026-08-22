-- `schemas` — les types de contenu, premier objet du CMS.
--
-- ⚠️ **Cadré par `environment_id`, jamais par `project_id`** (ADR 0006). Un
-- projet ne contient pas de schéma : il contient des environnements, qui en
-- contiennent. Il n'y a aujourd'hui qu'un `master` par projet, invisible dans
-- l'UI — c'est ce qui permettra d'éprouver un changement destructif de schéma
-- contre du contenu réel sans casser la production.
--
-- `organization_id` est dénormalisé, comme sur `api_keys` et `environments` :
-- une policy qui traverse une autre table sous RLS forme un cycle que Postgres
-- refuse. Chaque policy reste ainsi autonome (architecture/securite.md).
--
-- Aucun GRANT ici : les privilèges par défaut posés à l'amorçage donnent au
-- rôle applicatif ce qu'il faut sur toute table créée par le propriétaire
-- (scripts/bootstrap-db.ts).

CREATE TABLE "schemas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"label" text,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schemas_environment_id_name_key" UNIQUE("environment_id","name")
);
--> statement-breakpoint
ALTER TABLE "schemas" ADD CONSTRAINT "schemas_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schemas" ADD CONSTRAINT "schemas_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schemas" ADD CONSTRAINT "schemas_environment_fk" FOREIGN KEY ("environment_id","organization_id") REFERENCES "public"."environments"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schemas_organization_id_idx" ON "schemas" USING btree ("organization_id","environment_id");
--> statement-breakpoint

ALTER TABLE schemas ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE schemas FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Une seule condition, sur la colonne que la table porte elle-même. Pas de
-- valeur de repli : `app_current_organization_id()` rend NULL hors contexte,
-- donc aucune ligne — *fail-closed*.
--
-- ⚠️ Une clé API n'a **pas** encore de chemin ici. Le jour où l'API de
-- livraison lira les schémas, il faudra une branche pour elle, comme
-- `api_keys_read` en a une. L'ajouter maintenant serait une policy sans
-- appelant.
CREATE POLICY schemas_read ON schemas
  FOR SELECT
  USING (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY schemas_write ON schemas
  FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
