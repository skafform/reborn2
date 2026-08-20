-- Clé étrangère vers Better-Auth, amorçage du catalogue, RLS sur les tables
-- d'autorisation, et protection du dernier `owner`.

-- ---------------------------------------------------------------------------
-- Lien vers la table `user` de Better-Auth
-- ---------------------------------------------------------------------------
-- Drizzle ne connaît pas cette table : elle appartient à Better-Auth (ADR
-- 0002). La contrainte est donc ajoutée à la main. Les migrations Better-Auth
-- tournent avant celles-ci, `user` existe déjà.
ALTER TABLE organization_members
  ADD CONSTRAINT organization_members_user_id_fk
  FOREIGN KEY (user_id) REFERENCES "user" ("id") ON DELETE CASCADE;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Catalogue de permissions
-- ---------------------------------------------------------------------------
-- Reflet de `src/config/permissions.ts`. Toute évolution du catalogue passe
-- par une nouvelle migration : c'est ce qui garantit qu'un rôle ne peut jamais
-- référencer une permission inexistante.
INSERT INTO permissions (key, description) VALUES
  ('content.read', 'Lire le contenu publié'),
  ('content.read_draft', 'Lire les brouillons'),
  ('content.write', 'Créer et modifier du contenu'),
  ('content.publish', 'Publier du contenu'),
  ('schema.read', 'Lire les définitions de types de contenu'),
  ('schema.write', 'Créer et modifier les types de contenu'),
  ('member.manage', 'Inviter, retirer et changer le rôle d''un membre non privilégié'),
  ('member.manage_admin', 'Accorder ou retirer les rôles owner et admin'),
  ('role.manage', 'Créer et modifier les rôles personnalisés'),
  ('apikey.manage', 'Créer, révoquer et supprimer les clés API'),
  ('project.create', 'Créer un projet'),
  ('project.delete', 'Supprimer un projet'),
  ('org.settings', 'Modifier les paramètres de l''organization'),
  ('org.billing', 'Gérer la facturation'),
  ('org.transfer', 'Transférer la propriété de l''organization'),
  ('org.delete', 'Supprimer l''organization')
;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- `updated_at`
-- ---------------------------------------------------------------------------
CREATE TRIGGER roles_set_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER organization_members_set_updated_at BEFORE UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Rôles système : ni modifiables, ni supprimables
-- ---------------------------------------------------------------------------
CREATE FUNCTION protect_system_roles() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'system roles cannot be deleted'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_system AND (NEW.name <> OLD.name OR NEW.scope <> OLD.scope
                        OR NEW.is_system <> OLD.is_system) THEN
    RAISE EXCEPTION 'system roles cannot be modified'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER roles_protect_system BEFORE UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION protect_system_roles();
--> statement-breakpoint

-- Les permissions d'un rôle système sont figées elles aussi : les modifier
-- reviendrait à modifier le rôle.
CREATE FUNCTION protect_system_role_permissions() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  target uuid := COALESCE(NEW.role_id, OLD.role_id);
BEGIN
  IF EXISTS (SELECT 1 FROM roles WHERE id = target AND is_system) THEN
    RAISE EXCEPTION 'permissions of a system role cannot be changed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint

-- Pas de trigger sur INSERT : l'amorçage d'une organization crée le rôle
-- système *puis* ses permissions. Le verrou porte sur la modification.
CREATE TRIGGER role_permissions_protect_system BEFORE UPDATE OR DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION protect_system_role_permissions();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Dernier `owner`
-- ---------------------------------------------------------------------------
-- Invariant d'intégrité, pas règle d'autorisation : deux requêtes simultanées
-- « retire-moi » vérifieraient chacune qu'un autre owner existe et passeraient
-- toutes les deux. Seule la base peut l'empêcher sous concurrence.
--
-- Le verrou sur la ligne organization sérialise les modifications d'adhésion
-- de cette organization.
CREATE FUNCTION protect_last_owner() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  org uuid := COALESCE(NEW.organization_id, OLD.organization_id);
  remaining int;
BEGIN
  PERFORM 1 FROM organizations WHERE id = org FOR UPDATE;

  SELECT count(*) INTO remaining
  FROM organization_members m
  JOIN roles r ON r.id = m.role_id
  WHERE m.organization_id = org AND r.is_system AND r.name = 'owner';

  IF remaining = 0 AND EXISTS (SELECT 1 FROM organizations WHERE id = org) THEN
    RAISE EXCEPTION 'an organization must keep at least one owner'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER organization_members_protect_last_owner
  AFTER UPDATE OR DELETE ON organization_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION protect_last_owner();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- `permissions` est un vocabulaire commun, non cadré par locataire : lecture
-- ouverte, écriture réservée aux migrations.
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY permissions_read ON permissions FOR SELECT USING (true);
--> statement-breakpoint

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY roles_tenant ON roles FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY role_permissions_tenant ON role_permissions FOR ALL
  USING (role_id IN (
    SELECT id FROM roles WHERE organization_id = app_current_organization_id()))
  WITH CHECK (role_id IN (
    SELECT id FROM roles WHERE organization_id = app_current_organization_id()));
--> statement-breakpoint

ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Deux critères, chacun pour ce qu'il sait faire : l'organization courante
-- pour travailler dans une organization, l'utilisateur courant pour la
-- requête transverse « mes organizations », qui n'a pas d'organization
-- courante.
CREATE POLICY organization_members_tenant ON organization_members FOR ALL
  USING (
    organization_id = app_current_organization_id()
    OR user_id = app_current_user_id()
  )
  WITH CHECK (organization_id = app_current_organization_id());
