-- RLS et clé étrangère vers Better-Auth pour `project_members`.

ALTER TABLE project_members
  ADD CONSTRAINT project_members_user_id_fk
  FOREIGN KEY (user_id) REFERENCES "user" ("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE TRIGGER project_members_set_updated_at BEFORE UPDATE ON project_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Deux critères, comme pour `organization_members` : l'organization courante
-- pour y travailler, l'utilisateur courant pour la requête transverse « mes
-- projets », qui n'a pas d'organization courante.
--
-- Un membre de projet est extérieur à l'organization : il n'a pas de ligne
-- dans `organization_members`, donc `app_is_member_of` ne le reconnaît pas.
-- C'est voulu — sa visibilité s'arrête au projet.
CREATE POLICY project_members_read ON project_members
  FOR SELECT
  USING (
    organization_id = app_current_organization_id()
    OR user_id = app_current_user_id()
  );
--> statement-breakpoint

CREATE POLICY project_members_write ON project_members
  FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

-- `projects` doit rester visible à un membre de projet extérieur à
-- l'organization, sinon il ne peut atteindre ni son projet ni son contenu.
DROP POLICY projects_tenant ON projects;
--> statement-breakpoint

CREATE FUNCTION app_is_project_member(target uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM project_members m
      WHERE m.project_id = target
        AND m.user_id = app_current_user_id()
    )
  $$;
--> statement-breakpoint

CREATE POLICY projects_read ON projects
  FOR SELECT
  USING (
    organization_id = app_current_organization_id()
    OR app_is_member_of(organization_id)
    OR app_is_project_member(id)
  );
--> statement-breakpoint

CREATE POLICY projects_insert ON projects
  FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY projects_update ON projects
  FOR UPDATE
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY projects_delete ON projects
  FOR DELETE
  USING (organization_id = app_current_organization_id());
