-- L'Inbox : retrouver les invitations adressées à sa propre adresse, sans
-- jeton. Seul le hachage du jeton est stocké (docs/architecture/invitations.md)
-- — une invitation retrouvée dans l'Inbox n'a donc jamais eu le jeton en main,
-- contrairement au lien reçu par email.
--
-- Troisième branche, symétrique aux deux existantes : la session vérifiée
-- devient son propre laissez-passer, au même titre que l'organization
-- courante ou la possession du jeton.
CREATE FUNCTION app_current_user_email() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(lower(current_setting('app.current_user_email', true)), '') $$;
--> statement-breakpoint

DROP POLICY invitations_read ON invitations;
--> statement-breakpoint

CREATE POLICY invitations_read ON invitations
  FOR SELECT
  USING (
    organization_id = app_current_organization_id()
    OR token_hash = app_invitation_token_hash()
    OR email = app_current_user_email()
  );
--> statement-breakpoint

-- L'acceptation par l'Inbox met à jour la ligne sans jeton : la session
-- vérifiée doit pouvoir le faire, au même titre que le porteur du jeton.
DROP POLICY invitations_accept ON invitations;
--> statement-breakpoint

CREATE POLICY invitations_accept ON invitations
  FOR UPDATE
  USING (
    organization_id = app_current_organization_id()
    OR token_hash = app_invitation_token_hash()
    OR email = app_current_user_email()
  )
  WITH CHECK (
    organization_id = app_current_organization_id()
    OR token_hash = app_invitation_token_hash()
    OR email = app_current_user_email()
  );
