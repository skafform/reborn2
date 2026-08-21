-- `member.read` : voir l'annuaire de l'organization, sans pouvoir le modifier.
--
-- Le `viewer` est « un admin sans écriture » — il voit qui est dans l'équipe,
-- mais ni qui est en train d'y être admis, ni comment l'inviter. Sans cette
-- colonne, `member.read` et `member.manage` auraient des colonnes identiques
-- partout et n'en feraient qu'une (ADR 0004).
--
-- ⚠️ Trois tables doivent voir leur `FORCE` levé le temps de l'opération :
-- `permissions` n'a aucune policy d'écriture (son contenu appartient aux
-- migrations), et `roles` / `role_permissions` sont cadrées par organization —
-- or une migration n'a aucun contexte d'organization. Sans ça, le remplissage
-- ne toucherait aucune ligne, silencieusement (voir architecture/securite.md).
ALTER TABLE permissions NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE role_permissions NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

INSERT INTO permissions (key, description) VALUES
  ('member.read', 'Voir les membres de l''organization')
;
--> statement-breakpoint

-- Les organizations déjà créées ont leurs rôles système semés depuis
-- `SYSTEM_ROLES` **au moment de leur création** : elles ne bénéficient donc
-- pas d'un changement du catalogue. Ce rattrapage leur accorde la nouvelle
-- permission, exactement aux trois rôles qui la reçoivent désormais à
-- l'amorçage.
--
-- Pas de trigger à désactiver : `role_permissions_protect_system` porte sur
-- UPDATE et DELETE, jamais sur INSERT — précisément pour que l'amorçage d'une
-- organization puisse créer le rôle système puis ses permissions.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'member.read'
FROM roles r
WHERE r.is_system
  AND r.scope = 'organization'
  AND r.name IN ('owner', 'admin', 'viewer')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
