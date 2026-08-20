-- Ce qu'un porteur de jeton d'invitation a le droit de voir.
--
-- Le jeton rend visible sa ligne d'invitation (migration 0010), mais décider
-- s'il accepte suppose de savoir **quelle organization** l'invite et **à quel
-- rôle**. Or il n'est membre d'aucune des deux : les jointures étaient donc
-- filtrées et l'invitation paraissait introuvable.
--
-- Plutôt que d'ouvrir un chemin privilégié dans le code, on énonce en policy
-- ce que le jeton révèle — précisément l'organization et le rôle que **cette**
-- invitation désigne, rien d'autre.

DROP POLICY organizations_read ON organizations;
--> statement-breakpoint

CREATE POLICY organizations_read ON organizations
  FOR SELECT
  USING (
    id = app_current_organization_id()
    OR app_is_member_of(id)
    OR EXISTS (
      SELECT 1 FROM invitations i
      WHERE i.organization_id = organizations.id
        AND i.token_hash = app_invitation_token_hash()
    )
  );
--> statement-breakpoint

DROP POLICY roles_read ON roles;
--> statement-breakpoint

CREATE POLICY roles_read ON roles
  FOR SELECT
  USING (
    organization_id = app_current_organization_id()
    OR app_is_member_of(organization_id)
    OR EXISTS (
      SELECT 1 FROM invitations i
      WHERE i.role_id = roles.id
        AND i.token_hash = app_invitation_token_hash()
    )
  );
