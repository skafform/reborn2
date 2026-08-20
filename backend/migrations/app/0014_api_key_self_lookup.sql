-- Une clé API se résout elle-même.
--
-- Quand une clé arrive dans une requête, on ne sait pas encore de quel
-- locataire il s'agit : c'est justement ce qu'elle détermine. Aucun contexte
-- d'organization n'est donc disponible pour la retrouver — même amorçage que
-- pour le jeton d'invitation.
--
-- La clé est son propre laissez-passer, exprimé en policy. Elle rend visibles
-- exactement sa propre ligne, l'environnement et le projet qui la portent :
-- de quoi résoudre le locataire, rien de plus.
--
-- Deux comparaisons sont nécessaires : les clés publique et preview sont
-- stockées en clair, la clé secrète sous forme de hachage.

CREATE FUNCTION app_api_key_token() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.api_key_token', true), '') $$;
--> statement-breakpoint

CREATE FUNCTION app_api_key_token_hash() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.api_key_token_hash', true), '') $$;
--> statement-breakpoint

CREATE POLICY api_keys_self_lookup ON api_keys
  FOR SELECT
  USING (token = app_api_key_token() OR token_hash = app_api_key_token_hash());
--> statement-breakpoint

-- L'environnement et le projet que la clé désigne, pour remonter jusqu'à
-- l'organization. Rien d'autre du locataire n'est révélé.
CREATE FUNCTION app_environment_bears_presented_key(target uuid)
  RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM api_keys k
       WHERE k.environment_id = target
         AND (k.token = app_api_key_token()
              OR k.token_hash = app_api_key_token_hash())
    )
  $$;
--> statement-breakpoint

DROP POLICY projects_read ON projects;
--> statement-breakpoint

CREATE POLICY projects_read ON projects
  FOR SELECT
  USING (
    organization_id = app_current_organization_id()
    OR app_is_member_of(organization_id)
    OR app_is_project_member(id)
    OR EXISTS (
      SELECT 1 FROM environments e
       WHERE e.project_id = projects.id
         AND app_environment_bears_presented_key(e.id)
    )
  );
--> statement-breakpoint

ALTER TABLE environments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY environments_tenant ON environments;
--> statement-breakpoint

CREATE POLICY environments_read ON environments
  FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM projects WHERE organization_id = app_current_organization_id()
    )
    OR app_environment_bears_presented_key(id)
  );
--> statement-breakpoint

CREATE POLICY environments_write ON environments
  FOR ALL
  USING (
    project_id IN (
      SELECT id FROM projects WHERE organization_id = app_current_organization_id()
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT id FROM projects WHERE organization_id = app_current_organization_id()
    )
  );
