-- Policy de lecture de `organizations` fondée sur l'appartenance.
--
-- La version précédente exigeait `id = app_current_organization_id()`, faute
-- de table d'adhésion. Or « lister mes organizations » n'a pas d'organization
-- courante — c'est une requête transverse, et la première que voit un
-- utilisateur en se connectant.
--
-- C'est la seule table où une sous-requête est nécessaire ; elle reste petite.
-- Les tables situées en dessous gardent leur policy sur la colonne de cadrage,
-- simple et indexable, sur le chemin chaud.
--
-- Conforme à l'ADR 0003 : on vérifie qu'une adhésion existe — la frontière du
-- locataire — jamais *quel* rôle. Backlog #0005.

DROP POLICY organizations_read ON organizations;
--> statement-breakpoint

CREATE POLICY organizations_read ON organizations
  FOR SELECT
  USING (
    id = app_current_organization_id()
    OR EXISTS (
      SELECT 1 FROM organization_members m
      WHERE m.organization_id = organizations.id
        AND m.user_id = app_current_user_id()
    )
  );
