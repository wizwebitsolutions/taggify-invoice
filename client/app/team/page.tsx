"use client";

import { OwnSectionGate } from "@/components/auth/own-section-gate";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField } from "@/components/ui/form-field";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { PlusIcon, TeamIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { users as usersApi, ApiError, canUse } from "@/lib/api-client";
import { initialsOf, roleLabel } from "@/lib/format";

export default function TeamPage() {
  return (
    <RequireAuth>
      <OwnSectionGate ownKey="users.view" active="team">
        <TeamContent />
      </OwnSectionGate>
    </RequireAuth>
  );
}

function TeamContent() {
  const { user, accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const token = accessToken!;
  const isCreator = user?.role === "CREATOR";
  // Adding members needs Team → Manage (24 Sep — an admin can switch it off).
  const canManageTeam = isCreator && canUse(user, "users.edit");

  const teamQuery = useQuery({
    queryKey: ["team"],
    queryFn: () => usersApi.team(token),
    enabled: isCreator,
  });

  return (
    <AppShell
      active="team"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search team members…"
      topbarActions={
        canManageTeam ? (
          <Button size="default" onClick={() => setShowForm(true)}>
            <PlusIcon className="h-[15px] w-[15px] text-accent-ink" />
            Add member
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">Admin</p>
            <h1 className="mb-1 text-[1.5rem] font-semibold leading-tight tracking-[-0.03em] md:text-[1.625rem]">Team</h1>
            <p className="max-w-[56ch] text-[0.875rem] text-text-muted">People helping manage your pages and links.</p>
          </div>
          {/* Desktop carries this same action in the topbar (hidden below md). */}
          {canManageTeam && (
            <Button size="icon" className="shrink-0 md:hidden" onClick={() => setShowForm(true)} aria-label="Add member">
              <PlusIcon className="h-4 w-4 text-accent-ink" />
            </Button>
          )}
        </div>

        {!isCreator ? (
          <div className="rounded-lg border border-border bg-surface p-8 text-center shadow-card">
            <p className="max-w-[56ch] text-[0.875rem] text-text-muted">Team management is available to Creator accounts.</p>
          </div>
        ) : teamQuery.isLoading ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <TableSkeleton />
          </div>
        ) : (teamQuery.data ?? []).length === 0 ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <EmptyState label="No team members added yet." />
          </div>
        ) : (
          // overflow-x-auto + a min-width floor (rather than a mobile card
          // rewrite, out of proportion for an admin-only, occasional-use
          // table) — the table scrolls within its own card on a narrow
          // screen instead of forcing the whole page to scroll sideways.
          <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
            <div className="grid min-w-[480px] grid-cols-[2fr_1fr_1fr] gap-3 border-b border-border px-5 py-3.5">
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">User ID</div>
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">Can see money</div>
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">Added</div>
            </div>
            {(teamQuery.data ?? []).map((m) => (
              <div key={m.id} className="grid min-w-[480px] grid-cols-[2fr_1fr_1fr] items-center gap-3 border-b border-border px-5 py-4 last:border-b-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2">
                    <TeamIcon className="h-4 w-4 text-text-muted" />
                  </div>
                  <span className="truncate font-mono text-[0.8125rem] text-text-muted">{m.userId}</span>
                </div>
                <span className="text-[0.8438rem] text-text-muted">{m.canSeeMoney ? "Yes" : "No"}</span>
                <span className="text-[0.8438rem] text-text-faint">{new Date(m.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <AddMemberModal
          token={token}
          onClose={() => setShowForm(false)}
          onAdded={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ["team"] });
          }}
        />
      )}
    </AppShell>
  );
}

function AddMemberModal({ token, onClose, onAdded }: { token: string; onClose: () => void; onAdded: () => void }) {
  const [userId, setUserId] = useState("");
  const [canSeeMoney, setCanSeeMoney] = useState(false);

  const addMutation = useMutation({
    mutationFn: () => usersApi.addTeamMember(token, userId, canSeeMoney),
    onSuccess: onAdded,
  });

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[420px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addMutation.mutate();
        }}
        className="flex flex-col gap-5 overflow-y-auto p-6 pt-1"
      >
        <h2 className="text-lg font-semibold">Add a team member</h2>
        <Field label="Team member's user ID">
          <TextField required value={userId} onChange={setUserId} placeholder="Their account must already exist with role Team Member" />
        </Field>
        <label className="flex items-center gap-2.5 text-[0.8125rem] text-text-muted">
          <input type="checkbox" checked={canSeeMoney} onChange={(e) => setCanSeeMoney(e.target.checked)} className="h-4 w-4 rounded accent-[var(--accent)]" />
          Can see invoices and payment amounts
        </label>
        {addMutation.isError && (
          <ErrorNotice message={addMutation.error instanceof ApiError ? addMutation.error.message : "Couldn't add this member."} />
        )}
        <div className="flex gap-2.5">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={addMutation.isPending}>
            {addMutation.isPending ? "Adding…" : "Add member"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
