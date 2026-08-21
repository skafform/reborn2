-- Un membre de projet doit voir l'organization qui porte son projet.
--
-- Il n'a aucune ligne dans `organization_members` — c'est voulu, il lui reste
-- extérieur. Mais la console le fait naviguer par organization : sans ces
-- branches, l'organization hôte n'apparaît nulle part et son projet est
-- inatteignable (architecture/multi-tenant.md).
--
-- ⚠️ `app_is_member_of` n'est **pas** élargie. Elle sert dans onze policies
-- réparties sur six migrations : y ajouter les membres de projet ouvrirait
-- d'un coup des tables où ce n'est pas voulu. Une fonction distincte, et une
-- branche par policy concernée — la méthode des migrations 0011 et 0021.
--
-- Aucun cycle : `project_members_read` et `invitations_read` ne consultent
-- aucune autre table, elles ne peuvent donc pas revenir vers celles d'ici
-- (migration 0016 pour le cas où ça s'est produit).

CREATE FUNCTION app_is_project_member_of_org(target uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM project_members m
      WHERE m.organization_id = target
        AND m.user_id = app_current_user_id()
    )
  $$;
--> statement-breakpoint

-- « Mes organizations » n'a pas d'organization courante : seule une branche
-- par appartenance peut faire apparaître l'hôte.
DROP POLICY organizations_read ON organizations;
--> statement-breakpoint

CREATE POLICY organizations_read ON organizations
  FOR SELECT
  USING (
    id = app_current_organization_id()
    OR app_is_member_of(id)
    OR app_is_project_member_of_org(id)
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

-- La même requête joint `roles` pour nommer le rôle. Élargir `organizations`
-- sans élargir `roles` rendrait la ligne visible puis la ferait disparaître à
-- la jointure — le piège que 0011 puis 0021 ont chacune corrigé après coup.
DROP POLICY roles_read ON roles;
--> statement-breakpoint

CREATE POLICY roles_read ON roles
  FOR SELECT
  USING (
    organization_id = app_current_organization_id()
    OR app_is_member_of(organization_id)
    OR app_is_project_member_of_org(organization_id)
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
--> statement-breakpoint

-- Une invitation de projet doit pouvoir nommer son projet — « Ideatrove —
-- editor » ne dit pas *sur quoi*. L'invité n'est encore membre de rien : sans
-- ces deux branches, la jointure vide l'Inbox et l'écran d'acceptation.
--
-- Troisième exemplaire du même piège, cette fois écrit avant de le subir.
DROP POLICY projects_read ON projects;
--> statement-breakpoint

CREATE POLICY projects_read ON projects
  FOR SELECT
  USING (
    organization_id = app_current_organization_id()
    OR app_is_member_of(organization_id)
    OR app_is_project_member(id)
    OR EXISTS (
      SELECT 1 FROM invitations i
      WHERE i.project_id = projects.id
        AND i.token_hash = app_invitation_token_hash()
    )
    OR EXISTS (
      SELECT 1 FROM invitations i
      WHERE i.project_id = projects.id
        AND i.email = app_current_user_email()
    )
  );
