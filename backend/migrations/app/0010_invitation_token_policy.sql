-- Le jeton d'invitation comme autorisation de lecture.
--
-- Accepter une invitation suppose de la lire — mais on n'est pas encore membre
-- de l'organization, donc aucun contexte d'organization n'est disponible. Le
-- même problème d'amorçage que la création d'une organization.
--
-- La sortie propre : **la possession du jeton est l'autorisation**, et elle
-- s'exprime en policy plutôt qu'en exception dans le code. Le destinataire
-- voit exactement une ligne, la sienne, et rien d'autre.
--
-- Le jeton n'est jamais stocké — seul son hachage l'est, comparé ici au
-- hachage posé en contexte.

CREATE FUNCTION app_invitation_token_hash() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.invitation_token_hash', true), '') $$;
--> statement-breakpoint

DROP POLICY invitations_tenant ON invitations;
--> statement-breakpoint

CREATE POLICY invitations_read ON invitations
  FOR SELECT
  USING (
    organization_id = app_current_organization_id()
    OR token_hash = app_invitation_token_hash()
  );
--> statement-breakpoint

-- L'acceptation met à jour la ligne : le porteur du jeton doit pouvoir le
-- faire, sans quoi il faudrait un chemin privilégié dans le code.
CREATE POLICY invitations_accept ON invitations
  FOR UPDATE
  USING (
    organization_id = app_current_organization_id()
    OR token_hash = app_invitation_token_hash()
  )
  WITH CHECK (
    organization_id = app_current_organization_id()
    OR token_hash = app_invitation_token_hash()
  );
--> statement-breakpoint

-- Créer et supprimer restent réservés au travail dans l'organization.
CREATE POLICY invitations_insert ON invitations
  FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY invitations_delete ON invitations
  FOR DELETE
  USING (organization_id = app_current_organization_id());
