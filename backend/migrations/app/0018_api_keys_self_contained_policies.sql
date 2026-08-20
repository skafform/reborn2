-- Des policies autonomes, sans traversée d'une autre table.
--
-- La migration 0014 faisait consulter `api_keys` par la policy de
-- `environments`, tandis que celle de `api_keys` consultait `environments` :
-- un second cycle, après celui entre `projects` et `environments`. Postgres
-- l'a signalé en épuisant la pile.
--
-- Le remède est le même, systématique : chaque table porte sa colonne de
-- cadrage, donc chaque policy se suffit à elle-même. Résoudre une clé API
-- devient une requête sur une seule table.

DROP POLICY api_keys_tenant ON api_keys;
--> statement-breakpoint
DROP POLICY api_keys_self_lookup ON api_keys;
--> statement-breakpoint
DROP FUNCTION IF EXISTS app_environment_in_current_organization(uuid);
--> statement-breakpoint

CREATE POLICY api_keys_read ON api_keys
  FOR SELECT
  USING (
    organization_id = app_current_organization_id()
    -- Une clé est son propre laissez-passer : elle arrive avant qu'on sache
    -- de quel locataire il s'agit, puisque c'est elle qui le détermine.
    OR token = app_api_key_token()
    OR token_hash = app_api_key_token_hash()
  );
--> statement-breakpoint

CREATE POLICY api_keys_write ON api_keys
  FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

-- `environments` n'a plus besoin de consulter `api_keys` : le porteur d'une
-- clé n'a aucune raison de lire la table des environnements, sa clé lui
-- donnant déjà son `organization_id`.
DROP POLICY environments_read ON environments;
--> statement-breakpoint
DROP FUNCTION IF EXISTS app_environment_bears_presented_key(uuid);
--> statement-breakpoint

CREATE POLICY environments_read ON environments
  FOR SELECT
  USING (organization_id = app_current_organization_id());
