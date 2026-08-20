-- RLS sur les clés API.
--
-- Une clé appartient à un environnement, qui appartient à un projet, qui
-- appartient à une organization : le cadrage se fait donc par remontée. La
-- gestion des clés suppose de travailler dans l'organization.

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION app_environment_in_current_organization(target uuid)
  RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1
        FROM environments e
        JOIN projects p ON p.id = e.project_id
       WHERE e.id = target
         AND p.organization_id = app_current_organization_id()
    )
  $$;
--> statement-breakpoint

CREATE POLICY api_keys_tenant ON api_keys
  FOR ALL
  USING (app_environment_in_current_organization(environment_id))
  WITH CHECK (app_environment_in_current_organization(environment_id));
