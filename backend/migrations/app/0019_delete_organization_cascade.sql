-- Une organization ne pouvait pas être supprimée (docs/backlog #0010).
--
-- `roles.organization_id` est en `ON DELETE CASCADE`. Supprimer une
-- organization propage donc un `DELETE` vers ses rôles, et
-- `protect_system_roles` l'interceptait sans distinguer les deux situations :
--
--   ERROR:  system roles cannot be deleted
--   CONTEXT: SQL statement "DELETE FROM ONLY "public"."roles"
--            WHERE $1 OPERATOR(pg_catalog.=) "organization_id""
--
-- Le garde-fou est juste, sa portée était trop large. Un rôle système ne doit
-- pas disparaître **tant que son organization existe** ; quand elle disparaît,
-- il n'a plus d'objet.
--
-- Le remède est celui que `protect_last_owner` emploie déjà dans ce même
-- fichier de départ : demander si l'organization existe encore. L'action
-- référentielle d'un `ON DELETE CASCADE` s'exécute **après** la suppression de
-- la ligne parente, donc au moment où ce trigger se déclenche l'organization
-- est déjà partie — et le trigger laisse faire. Sur une suppression directe de
-- rôle, elle est bien là, et le trigger refuse.
--
-- Aucun nouveau mécanisme : pas de marqueur de transaction, pas de drapeau
-- applicatif. Une seule question, posée à la base.
--
-- ⚠️ Ceci n'autorise pas *l'application* à supprimer une organization à la
-- légère : la règle métier — plus aucun membre, plus aucun projet — appartient
-- à la route `org.delete`, qui reste à écrire.
CREATE OR REPLACE FUNCTION protect_system_roles() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system
       AND EXISTS (SELECT 1 FROM organizations WHERE id = OLD.organization_id)
    THEN
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

-- Même correction, même raison, pour les permissions d'un rôle système.
--
-- La cascade `organizations -> roles -> role_permissions` supprime déjà la
-- ligne de `roles` avant que ce trigger ne se déclenche, donc `EXISTS` est
-- faux et rien ne bloque. Mais une suppression directe de rôle **non
-- système** — parfaitement légitime — cascade elle aussi vers ses permissions,
-- et le rôle est alors déjà parti : le garde-fou ne le voyait pas non plus.
-- L'ancienne formulation reposait donc sur cet effet de bord plutôt que de
-- l'énoncer. Elle est réécrite pour dire ce qu'elle vérifie.
CREATE OR REPLACE FUNCTION protect_system_role_permissions() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  target uuid := COALESCE(NEW.role_id, OLD.role_id);
BEGIN
  -- Le rôle absent signifie qu'il est en train d'être supprimé, lui ou son
  -- organization : ses permissions le suivent, il n'y a rien à protéger.
  IF EXISTS (SELECT 1 FROM roles WHERE id = target AND is_system) THEN
    RAISE EXCEPTION 'permissions of a system role cannot be changed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
