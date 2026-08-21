-- `project.settings` — split out of `org.settings`, which used to cover both.
--
-- Organization settings become owner-only: the name, the billing address and
-- the existence of an organization belong to whoever owns it, and delegation
-- goes through a custom role that says so (same shape as ADR 0014 for
-- `role.manage`).
--
-- ⚠️ Keeping a single key would have taken **project renaming** away from
-- admins as a side effect. They can create projects, run their teams and their
-- API keys — but could no longer name what they created. Hence the split
-- rather than a simple narrowing.
--
-- ⚠️ Changing the code catalogue would not be enough: system roles are copied
-- into each organization **when it is created** (ADR 0011). Existing
-- organizations would keep their old rows, and the change would only reach
-- organizations created afterwards.

-- Three tables need FORCE lifted: `permissions` has no write policy at all
-- (its contents belong to migrations), and `roles` / `role_permissions` are
-- scoped by organization — a migration has no organization context. Without
-- this, every statement below would touch zero rows, silently
-- (architecture/securite.md).
ALTER TABLE permissions NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE role_permissions NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

INSERT INTO permissions (key, description) VALUES
  ('project.settings', 'Rename a project and edit its description')
;
--> statement-breakpoint

-- The two system roles that hold it from now on. No trigger to disable:
-- `role_permissions_protect_system` fires on UPDATE and DELETE only, precisely
-- so that seeding an organization can create its system roles and then their
-- permissions.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'project.settings'
FROM roles r
WHERE r.is_system
  AND r.scope = 'organization'
  AND r.name IN ('owner', 'admin')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ⚠️ Custom roles keep what they had. A role holding `org.settings` was given
-- it when that key meant **both** things; leaving it at that would silently
-- remove an ability nobody decided to remove. They keep `org.settings` too —
-- narrowing a role an organization composed for itself would be deciding in
-- its place (same reasoning as migration 0025).
INSERT INTO role_permissions (role_id, permission_key)
SELECT rp.role_id, 'project.settings'
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
WHERE rp.permission_key = 'org.settings'
  AND NOT r.is_system
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ⚠️ This one deletes, so the guard has to go — it would fire, and it would be
-- right to.
ALTER TABLE role_permissions DISABLE TRIGGER role_permissions_protect_system;
--> statement-breakpoint

DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.id
  AND rp.permission_key = 'org.settings'
  AND r.is_system
  AND r.name <> 'owner';
--> statement-breakpoint

ALTER TABLE role_permissions ENABLE TRIGGER role_permissions_protect_system;
--> statement-breakpoint

ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
