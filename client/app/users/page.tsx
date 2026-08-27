"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField, Select } from "@/components/ui/form-field";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { PlusIcon, TeamIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { admin as adminApi, auth as authApi, ApiError, type User, type Role } from "@/lib/api-client";
import { initialsOf, roleLabel } from "@/lib/format";

const ROLES: Role[] = ["CREATOR", "TEAM_MEMBER", "ADMIN", "FINANCE"];

/**
 * Admin-only user directory + account creation. Per the login page's own
 * copy ("New creators are added by an admin — no self-signup"), this is
 * the only way a new account gets created — POST /auth/signup is now
 * admin-gated server-side to match.
 */
export default function UsersPage() {
  return (
    <RequireAuth>
      <UsersContent />
    </RequireAuth>
  );
}

function UsersContent() {
  const { user, accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const token = accessToken!;
  const isAdmin = user?.role === "ADMIN";

  const usersQuery = useQuery({ queryKey: ["adminUsers"], queryFn: () => adminApi.users(token), enabled: isAdmin });
  const items = usersQuery.data ?? [];

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => adminApi.updateUserRole(token, id, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["adminUsers"] }),
  });

  return (
    <AppShell
      active="users"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search users…"
      topbarActions={
        isAdmin ? (
          <Button size="default" onClick={() => setShowCreate(true)}>
            <PlusIcon className="h-[15px] w-[15px] text-accent-ink" />
            Add user
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">Admin</p>
            <h1 className="mb-1.5 text-[1.625rem] font-bold">Users</h1>
            <p className="text-[0.9375rem] text-text-muted">Every account on Taggify, and who can create new ones.</p>
          </div>
          {/* Desktop carries this same action in the topbar (hidden below md). */}
          {isAdmin && (
            <Button size="icon" className="shrink-0 md:hidden" onClick={() => setShowCreate(true)} aria-label="Add user">
              <PlusIcon className="h-4 w-4 text-accent-ink" />
            </Button>
          )}
        </div>

        {!isAdmin ? (
          <div className="rounded-lg border border-border bg-surface p-8 text-center shadow-card">
            <p className="text-[0.9375rem] text-text-muted">User management is available to Admin accounts.</p>
          </div>
        ) : usersQuery.isLoading ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <TableSkeleton />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <EmptyState label="No users yet." />
          </div>
        ) : (
          // overflow-x-auto + a min-width floor (rather than a mobile card
          // rewrite, out of proportion for an admin-only, occasional-use
          // table) — the table scrolls within its own card on a narrow
          // screen instead of forcing the whole page to scroll sideways.
          <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
            <div className="grid min-w-[560px] grid-cols-[2fr_1.5fr_1fr_1fr] gap-3 border-b border-border px-5 py-3.5">
              <div className="text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-text-faint">Name</div>
              <div className="text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-text-faint">Phone</div>
              <div className="text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-text-faint">Role</div>
              <div className="text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-text-faint">Joined</div>
            </div>
            {items.map((u) => (
              <div key={u.id} className="grid min-w-[560px] grid-cols-[2fr_1.5fr_1fr_1fr] items-center gap-3 border-b border-border px-5 py-4 last:border-b-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2">
                    <TeamIcon className="h-4 w-4 text-text-muted" />
                  </div>
                  <span className="truncate text-[0.8438rem] font-semibold">{u.name ?? "—"}</span>
                </div>
                <span className="truncate text-[0.8125rem] text-text-muted">{u.phoneNumber}</span>
                <select
                  value={u.role}
                  onChange={(e) => roleMutation.mutate({ id: u.id, role: e.target.value as Role })}
                  disabled={roleMutation.isPending || u.id === user?.id}
                  title={u.id === user?.id ? "You can't change your own role" : "Change role"}
                  className="h-8 w-fit rounded-md border border-border-strong bg-surface-2 px-2.5 text-[0.8125rem] text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-text-faint">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</span>
              </div>
            ))}
          </div>
        )}

        {roleMutation.isError && (
          <ErrorNotice message={roleMutation.error instanceof ApiError ? roleMutation.error.message : "Couldn't update that user's role."} />
        )}
      </div>

      {showCreate && (
        <CreateUserModal
          token={token}
          onClose={() => setShowCreate(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ["adminUsers"] })}
        />
      )}
    </AppShell>
  );
}

function CreateUserModal({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: () => void }) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("CREATOR");

  const createMutation = useMutation({
    mutationFn: () => authApi.signup(token, { phoneNumber: `+91${phoneNumber.replace(/\D/g, "")}`, name: name || undefined, role }),
    onSuccess: onCreated,
  });

  const created = createMutation.data;

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[420px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (created) {
            onClose();
            return;
          }
          createMutation.mutate();
        }}
        className="flex flex-col gap-5 overflow-y-auto p-6 pt-1"
      >
        <h2 className="text-lg font-bold">Add a user</h2>

        {created ? (
          <div className="flex flex-col gap-3">
            <p className="text-[0.8125rem] text-text-muted">
              Account created for <strong className="text-text">{created.user.phoneNumber}</strong>. Share this password with them now —
              it&apos;s shown only this once and can&apos;t be retrieved again.
            </p>
            <div className="rounded-md border border-border-strong bg-surface-2 px-3.5 py-3 text-center font-mono text-lg font-bold tracking-wide">
              {created.generatedPassword}
            </div>
          </div>
        ) : (
          <>
            <Field label="Phone number">
              <div className="flex h-11 items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-3.5 focus-within:ring-2 focus-within:ring-accent">
                <span className="text-[0.9375rem] text-text-faint">+91</span>
                <input
                  required
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="98765 43210"
                  className="w-full bg-transparent text-[0.9375rem] text-text placeholder:text-text-faint focus:outline-none"
                />
              </div>
            </Field>
            <Field label="Name (optional)">
              <TextField value={name} onChange={setName} placeholder="Their name" />
            </Field>
            <Field label="Role">
              <Select value={role} onChange={(v) => setRole(v as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {createMutation.isError && (
          <ErrorNotice message={createMutation.error instanceof ApiError ? createMutation.error.message : "Couldn't create this user."} />
        )}

        <div className="flex gap-2.5">
          {!created && (
            <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button type="submit" className="flex-1" disabled={createMutation.isPending || !phoneNumber}>
            {created ? "Done" : createMutation.isPending ? "Creating…" : "Create user"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
