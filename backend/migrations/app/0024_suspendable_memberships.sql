-- Une adhésion peut être suspendue : la ligne subsiste avec son rôle, mais ne
-- donne plus aucun accès (architecture/roles-permissions.md).
--
-- La colonne est lue à la **résolution du grant**, jamais dans `can()`. Une
-- suspension n'est pas une permission en moins, c'est une adhésion qui ne
-- compte plus — le point de vérification unique reste unique.
--
-- Aucune policy RLS ne change : `app_is_member_of` reste vraie pour un
-- suspendu, mais aucune route d'administration ne s'ouvre sans grant.

ALTER TABLE organization_members
  ADD COLUMN suspended_at timestamptz;
--> statement-breakpoint

ALTER TABLE project_members
  ADD COLUMN suspended_at timestamptz;
--> statement-breakpoint

-- ⚠️ Le garde-fou du dernier `owner` doit compter les propriétaires **actifs**.
--
-- Sans ce changement, la règle se contourne par une autre porte : suspendre le
-- seul `owner` laisse l'organization sans personne ayant de droits, et
-- personne ne peut le réactiver puisque ça demande `member.manage`. Retirer le
-- dernier propriétaire est refusé ; le suspendre l'aurait orphelinée
-- silencieusement.
--
-- Le reste de la fonction est inchangé : `AFTER UPDATE OR DELETE`, différée au
-- commit, et muette si l'organization elle-même a disparu — c'est ce qui
-- permet de supprimer une organization d'un bloc (migration 0019).
CREATE OR REPLACE FUNCTION protect_last_owner() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  org uuid := COALESCE(NEW.organization_id, OLD.organization_id);
  remaining int;
BEGIN
  PERFORM 1 FROM organizations WHERE id = org FOR UPDATE;

  SELECT count(*) INTO remaining
  FROM organization_members m
  JOIN roles r ON r.id = m.role_id
  WHERE m.organization_id = org
    AND r.is_system
    AND r.name = 'owner'
    AND m.suspended_at IS NULL;

  IF remaining = 0 AND EXISTS (SELECT 1 FROM organizations WHERE id = org) THEN
    RAISE EXCEPTION 'an organization must keep at least one active owner'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NULL;
END $$;
