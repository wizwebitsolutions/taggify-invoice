-- PermissionAuditLog.action (23 Sep): distinguishes overlay edits from role
-- changes and password resets, which are now audit-logged too.
ALTER TABLE "PermissionAuditLog" ADD COLUMN "action" TEXT NOT NULL DEFAULT 'permissions';
