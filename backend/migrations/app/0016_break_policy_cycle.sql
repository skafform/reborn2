-- Rupture du cycle de policies entre `projects` et `environments`.
--
-- La migration précédente ajoutait la lecture d'un projet à un porteur de clé
-- API, via une sous-requête sur `environments`. Or la policy de `environments`
-- consultait `projects` : Postgres détectait la récursion et refusait toute
-- requête sur les deux tables.
--
-- `SECURITY DEFINER` n'aurait pas suffi : `FORCE ROW LEVEL SECURITY` soumet
-- aussi le propriétaire aux policies, donc la fonction aurait rencontré la
-- même boucle.
--
-- La sortie est structurelle : `environments` porte désormais son
-- `organization_id`, donc plus aucune policy n'a besoin de traverser l'autre
-- table. Résoudre une clé API ne consulte même plus `projects`.


DROP POLICY IF EXISTS environments_read ON environments;
--> statement-breakpoint
CREATE POLICY environments_read ON environments
  FOR SELECT
  USING (
    organization_id = app_current_organization_id()
    OR app_environment_bears_presented_key(id)
  );
--> statement-breakpoint

DROP POLICY IF EXISTS environments_write ON environments;
--> statement-breakpoint
CREATE POLICY environments_write ON environments
  FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

-- `projects` retrouve sa policy d'origine : un porteur de clé n'a plus besoin
-- de la lire, l'organization se déduisant de l'environnement.

DROP POLICY IF EXISTS projects_read ON projects;
--> statement-breakpoint
CREATE POLICY projects_read ON projects
  FOR SELECT
  USING (
    organization_id = app_current_organization_id()
    OR app_is_member_of(organization_id)
    OR app_is_project_member(id)
  );
