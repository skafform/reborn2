-- Fonction d'appartenance, et policies de lecture transverses.
--
-- Le besoin est apparu deux fois : « mes organizations » n'a pas
-- d'organization courante, et sa jointure traverse `organizations` *et*
-- `roles`. Plutôt que de dupliquer la sous-requête, elle est nommée une fois.
--
-- Conforme à l'ADR 0003 : on vérifie qu'une adhésion existe — la frontière du
-- locataire — jamais *quel* rôle.

CREATE FUNCTION app_is_member_of(target uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM organization_members m
      WHERE m.organization_id = target
        AND m.user_id = app_current_user_id()
    )
  $$;
--> statement-breakpoint

DROP POLICY organizations_read ON organizations;
--> statement-breakpoint
CREATE POLICY organizations_read ON organizations
  FOR SELECT
  USING (id = app_current_organization_id() OR app_is_member_of(id));
--> statement-breakpoint

-- `roles` : lecture ouverte aux membres de l'organization, écriture réservée
-- au travail dans l'organization courante.
DROP POLICY roles_tenant ON roles;
--> statement-breakpoint

CREATE POLICY roles_read ON roles
  FOR SELECT
  USING (
    organization_id = app_current_organization_id()
    OR app_is_member_of(organization_id)
  );
--> statement-breakpoint

CREATE POLICY roles_insert ON roles
  FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY roles_update ON roles
  FOR UPDATE
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY roles_delete ON roles
  FOR DELETE
  USING (organization_id = app_current_organization_id());
