-- Même besoin que la migration 0011, pour l'Inbox plutôt que pour le jeton.
--
-- `email = app_current_user_email()` (migration 0020) rend visible la ligne
-- d'invitation, mais l'Inbox doit aussi savoir **quelle organization** et
-- **quel rôle** — sans quoi les jointures de `listReceivedInvitations`
-- filtrent la ligne, exactement le symptôme qui a justifié 0011.
--
-- Quatrième branche, symétrique aux trois existantes.

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
    OR EXISTS (
      SELECT 1 FROM invitations i
      WHERE i.organization_id = organizations.id
        AND i.email = app_current_user_email()
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
    OR EXISTS (
      SELECT 1 FROM invitations i
      WHERE i.role_id = roles.id
        AND i.email = app_current_user_email()
    )
  );
