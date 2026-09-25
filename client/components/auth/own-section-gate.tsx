"use client";

import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/lib/auth-context";
import { hasOwnAccess, isOwnScopeRole, type PermissionKey } from "@/lib/api-client";
import { initialsOf, roleLabel } from "@/lib/format";

/**
 * Page-level own-content switch (24 Sep): for a Creator / Team member /
 * Plan maker whose admin switched this section off, show a plain notice
 * instead of a page whose every request would 403. Staff roles and anyone
 * with the switch on get the page as usual (the server still enforces it
 * either way).
 */
export function OwnSectionGate({ ownKey, active, children }: { ownKey: PermissionKey; active: string; children: ReactNode }) {
  const { user } = useAuth();
  if (!isOwnScopeRole(user?.role) || hasOwnAccess(user, ownKey)) return <>{children}</>;
  return (
    <AppShell active={active} user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role) }} searchPlaceholder="Search…">
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface p-10 text-center" data-testid="access-removed">
        <p className="text-[0.9375rem] font-semibold">This section is turned off for your account</p>
        <p className="max-w-[44ch] text-[0.8125rem] text-text-muted">Your admin has removed your access to it. Ask them if you think you should have it.</p>
      </div>
    </AppShell>
  );
}
