-- Clé étrangère vers Better-Auth, unicité des invitations actives, et RLS.

-- `SET NULL` : l'invitation survit à la suppression de son émetteur, dont la
-- trace reste utile même s'il a quitté la plateforme.
ALTER TABLE invitations
  ADD CONSTRAINT invitations_invited_by_fk
  FOREIGN KEY (invited_by) REFERENCES "user" ("id") ON DELETE SET NULL;
--> statement-breakpoint

-- Une seule invitation **active** par destinataire et par cible : sans cela,
-- inviter deux fois empile des jetons valides simultanément.
--
-- `NULLS NOT DISTINCT` est indispensable : Postgres considère deux NULL comme
-- différents par défaut, donc deux invitations au niveau organization — où
-- `project_id` est nul — passeraient toutes les deux.
--
-- Une invitation expirée reste dans l'index ; le service l'annule avant d'en
-- créer une nouvelle. C'est voulu : `now()` ne peut pas figurer dans un
-- prédicat d'index, n'étant pas immuable.
CREATE UNIQUE INDEX invitations_active_uidx
  ON invitations (organization_id, project_id, email)
  NULLS NOT DISTINCT
  WHERE accepted_at IS NULL AND cancelled_at IS NULL;
--> statement-breakpoint

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Gérer les invitations d'une organization suppose d'y travailler.
CREATE POLICY invitations_tenant ON invitations
  FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
