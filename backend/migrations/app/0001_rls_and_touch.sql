-- Row Level Security et trigger `updated_at`.
--
-- Voir ADR 0003 : RLS ne porte que la frontière multi-tenant. Aucune policy ne
-- regarde un rôle — seulement l'existence d'une adhésion ou l'égalité de la
-- colonne de cadrage. Les rôles restent en TypeScript.

-- ---------------------------------------------------------------------------
-- Contexte de la requête
-- ---------------------------------------------------------------------------
-- Posé par `set_config('app.…', $1, true)` en début de transaction — le
-- troisième argument limite la portée à la transaction, sans quoi la valeur
-- fuiterait vers la requête suivante du pool.
--
-- Ces fonctions renvoient NULL quand le contexte est absent : les
-- comparaisons valent alors NULL et aucune ligne ne passe. C'est un
-- comportement *fail-closed*, et il ne doit jamais être adouci par une valeur
-- de repli.

CREATE FUNCTION app_current_user_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.current_user_id', true), '') $$;
--> statement-breakpoint

CREATE FUNCTION app_current_organization_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.current_organization_id', true), '')::uuid $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- `updated_at`
-- ---------------------------------------------------------------------------
CREATE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
--> statement-breakpoint

CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- FORCE s'ajoute à ENABLE : sans lui, le propriétaire des tables contournerait
-- les policies. Défense en profondeur, le serveur se connectant déjà avec un
-- rôle non-propriétaire.

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE environments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE environments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- `organizations` : les policies sont séparées par commande, parce que la
-- création n'obéit pas au même critère que l'accès.
--
-- Créer une organization ne peut pas exiger d'en être déjà membre, ni qu'elle
-- soit l'organization courante — elle n'existe pas encore. Le critère est
-- simplement qu'un utilisateur soit authentifié : n'importe quel inscrit peut
-- créer une organization (architecture/multi-tenant.md).
--
-- NOTE : `organization_members` n'existe pas encore (étape 3b). En attendant,
-- l'accès s'appuie sur l'organization courante ; la policy sera remplacée par
-- sa version par appartenance à l'étape 3b.
CREATE POLICY organizations_insert ON organizations
  FOR INSERT
  WITH CHECK (app_current_user_id() IS NOT NULL);
--> statement-breakpoint

CREATE POLICY organizations_read ON organizations
  FOR SELECT
  USING (id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY organizations_write ON organizations
  FOR UPDATE
  USING (id = app_current_organization_id())
  WITH CHECK (id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY organizations_delete ON organizations
  FOR DELETE
  USING (id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY projects_tenant ON projects
  FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE POLICY environments_tenant ON environments
  FOR ALL
  USING (
    project_id IN (
      SELECT id FROM projects WHERE organization_id = app_current_organization_id()
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT id FROM projects WHERE organization_id = app_current_organization_id()
    )
  );
