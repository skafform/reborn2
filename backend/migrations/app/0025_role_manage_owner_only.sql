-- `role.manage` is held by the system `owner` role only (ADR 0014).
--
-- An admin assigns the roles that exist; they no longer decide what a role
-- means. Without an audit log, the role list is the only trace of a change to
-- the permission model, and a list only works as a record if one person writes
-- to it.
--
-- ⚠️ Removing the permission from the code catalogue would not be enough:
-- system roles are **copied into each organization when it is created**
-- (ADR 0011). Existing organizations would keep their `admin -> role.manage`
-- row, and the change would only apply to the ones created afterwards.

-- `roles` and `role_permissions` are scoped by organization, and a migration
-- has no organization context: without lifting FORCE the delete would touch no
-- row at all, silently (architecture/securite.md).
ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE role_permissions NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ⚠️ The trigger has to go too, unlike migration 0022. That one **inserted**,
-- and `role_permissions_protect_system` only fires on UPDATE and DELETE —
-- precisely so that seeding an organization can create its system roles and
-- then their permissions. This one deletes: the guard would fire, and it would
-- be right to.
ALTER TABLE role_permissions DISABLE TRIGGER role_permissions_protect_system;
--> statement-breakpoint

DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.id
  AND rp.permission_key = 'role.manage'
  AND r.is_system
  AND r.name <> 'owner';
--> statement-breakpoint

ALTER TABLE role_permissions ENABLE TRIGGER role_permissions_protect_system;
--> statement-breakpoint

-- ⚠️ Custom roles are left alone: a role an organization composed for itself
-- belongs to it, and stripping it would be deciding in its place. None exists
-- today — nothing can create one yet — but the `is_system` clause states the
-- intent rather than relying on that fact.
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
