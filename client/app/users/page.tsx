"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField, Select, MoneyField, PhoneField } from "@/components/ui/form-field";
import { CategoryPicker } from "@/components/ui/category-picker";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { PlusIcon, TeamIcon, AssetIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/chips";
import { Tag } from "@/components/ui/tag";
import { Card, CardHeader, Table, THead, TH, TR, TD, Cell2 } from "@/components/ui/data-table";
import { useAuth } from "@/lib/auth-context";
import {
  admin as adminApi,
  auth as authApi,
  assets as assetsApi,
  LINK_FORMATS,
  ApiError,
  hasAccess,
  PERMISSION_KEYS,
  ROLE_DEFAULT_PERMISSIONS,
  OWN_CAPABILITIES,
  defaultOwnAccess,
  hasOwnAccess,
  isOwnScopeRole,
  type User,
  type Role,
  type Permissions,
  type Asset,
} from "@/lib/api-client";
import { AccessEditor, AccessSummary } from "@/components/users/access-editor";
import { initialsOf, roleLabel, money, personLabel, followersLabel } from "@/lib/format";

const ROLES: Role[] = ["CREATOR", "TEAM_MEMBER", "ADMIN", "FINANCE", "PLAN_MAKER"];

// Every role gets an access editor (24 Sep). Staff (Admin/Finance) hold
// global sections; Creator / Team member / Plan maker get own-content
// switches (lib/api-client.ts OWN_CAPABILITIES) that never reach anyone
// else's data.
const accessBaseline = (role: Role): Permissions => (isOwnScopeRole(role) ? defaultOwnAccess(role) : ROLE_DEFAULT_PERMISSIONS[role]);
const accessOf = (u: User): Permissions =>
  isOwnScopeRole(u.role)
    ? (Object.fromEntries(PERMISSION_KEYS.map((k) => [k, hasOwnAccess(u, k)])) as Permissions)
    : (u.permissions as Permissions);
// Only these can be reset / have their email changed by a non-full admin (mirrors admin/service.js).
const SUB_ADMIN_RESETTABLE_ROLES: Role[] = ["CREATOR", "TEAM_MEMBER"];

// A plain, unrestricted ADMIN — the only actor the server lets touch another
// ADMIN account's role or password, or promote anyone to ADMIN (see
// admin/service.js's updateUserRole). Mirrored here so the dropdown doesn't
// offer what would 403.
const isFullAdmin = (u: { role?: Role; permissions?: Permissions } | null | undefined) =>
  u?.role === "ADMIN" && !PERMISSION_KEYS.some((k) => u.permissions?.[k] === false);

/** True once a role's overlay deviates at all from that role's own baseline — used to badge both directions (a sub-admin missing something, or any role granted something extra) with one check. */
const deviatesFromBaseline = (role: Role, permissions: Permissions | undefined) =>
  !!permissions && PERMISSION_KEYS.some((k) => permissions[k] !== accessBaseline(role)[k]);

// Only CREATOR accounts own Instagram pages (see system design.md's roles) —
// Team member/Admin/Finance accounts have no use for one, so the "at least
// one page" requirement (newTask.md #6) only applies when creating a
// CREATOR. Stated here since the source request didn't spell out which
// roles it covers.
const ROLE_REQUIRES_PAGE: Role = "CREATOR";

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
  const [resettingUser, setResettingUser] = useState<User | null>(null);
  const [emailUser, setEmailUser] = useState<User | null>(null);
  const [editingAccessUser, setEditingAccessUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Role | "ALL">("CREATOR");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const token = accessToken!;
  // "Admin" in the loose sense of "can manage People" — a plain ADMIN by
  // default, or (15 Sep) any other role explicitly granted users.view.
  const isAdmin = hasAccess(user, "users.view");
  const actorIsFullAdmin = isFullAdmin(user);
  // Mirror admin/service.js's guards so the UI never offers what would 403
  // (23 Sep): a non-full-admin may only reset Creator / Team member
  // passwords (any other role could out-rank them once signed in as), and
  // may not edit an ADMIN's overlay at all.
  const canResetPassword = (u: User) => actorIsFullAdmin || SUB_ADMIN_RESETTABLE_ROLES.includes(u.role);
  const canEditAccess = (u: User) => actorIsFullAdmin || u.role !== "ADMIN";

  const usersQuery = useQuery({ queryKey: ["adminUsers"], queryFn: () => adminApi.users(token), enabled: isAdmin });
  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token), enabled: isAdmin });
  const items = usersQuery.data ?? [];
  const pagesByOwner = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const a of assetsQuery.data ?? []) map.set(a.ownerId, [...(map.get(a.ownerId) ?? []), a]);
    return map;
  }, [assetsQuery.data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: items.length };
    for (const r of ROLES) c[r] = items.filter((u) => u.role === r).length;
    return c;
  }, [items]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((u) => tab === "ALL" || u.role === tab).filter((u) => !q || (u.name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q) || (u.phoneNumber ?? "").includes(q));
  }, [items, tab, search]);
  const selected = visible.find((u) => u.id === selectedId) ?? null;

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => adminApi.updateUserRole(token, id, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["adminUsers"] }),
  });

  const isSubAdmin = (u: User) => u.role === "ADMIN" && deviatesFromBaseline(u.role, u.permissions);
  // The non-ADMIN counterpart (15 Sep) — a Finance/Planner whose overlay
  // deviates from that role's own baseline (a grant on top of it, or a
  // baseline section taken away).
  const hasGrantedAccess = (u: User) => u.role === "FINANCE" && deviatesFromBaseline(u.role, u.permissions);
  // An own-scope account with a section switched off (24 Sep).
  const hasLimitedAccess = (u: User) => isOwnScopeRole(u.role) && deviatesFromBaseline(u.role, accessOf(u));

  return (
    <AppShell
      active="users"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search users…"
      topbarActions={
        isAdmin ? (
          <Button onClick={() => setShowCreate(true)}>
            <PlusIcon className="h-4 w-4" />
            Add user
          </Button>
        ) : undefined
      }
      fab={
        isAdmin ? (
          <Button size="icon" className="h-12 w-12 rounded-full shadow-lg" onClick={() => setShowCreate(true)} aria-label="Add user">
            <PlusIcon className="h-5 w-5" />
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <PageHeader title="People" subtitle="Creators, team members, planners and finance. Every creator owns at least one page." />

        {!isAdmin ? (
          <Card className="p-8 text-center">
            <p className="text-[0.875rem] text-text-muted">User management is available to Admin accounts, or any account granted access to it.</p>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <Tabs
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { value: "CREATOR" as const, label: "Creators", count: counts.CREATOR },
                    { value: "TEAM_MEMBER" as const, label: "Team members", count: counts.TEAM_MEMBER },
                    { value: "PLAN_MAKER" as const, label: "Planners", count: counts.PLAN_MAKER },
                    { value: "FINANCE" as const, label: "Finance", count: counts.FINANCE },
                    { value: "ADMIN" as const, label: "Admins", count: counts.ADMIN },
                    { value: "ALL" as const, label: "All", count: counts.ALL },
                  ]}
                />
              </div>
              <label className="relative block w-full sm:w-[240px]">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email or phone" aria-label="Search users" className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[0.8125rem] shadow-card placeholder:text-text-faint focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink-10" />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
              <Card>
                {usersQuery.isLoading ? (
                  <TableSkeleton />
                ) : visible.length === 0 ? (
                  <EmptyState label={items.length === 0 ? "No users yet." : "No one matches."} />
                ) : (
                  <Table data-testid="users-table">
                    <THead>
                      <tr>
                        <TH>Name</TH>
                        <TH className="hidden md:table-cell">Email</TH>
                        <TH className="hidden xl:table-cell">Pages</TH>
                        <TH>Role</TH>
                        <TH className="hidden xl:table-cell">Joined</TH>
                        <TH />
                      </tr>
                    </THead>
                    <tbody>
                      {visible.map((u, i) => {
                        const pages = pagesByOwner.get(u.id) ?? [];
                        return (
                          <TR key={u.id} interactive selected={selected?.id === u.id} onClick={() => setSelectedId(u.id)} style={{ animationDelay: `${0.15 + i * 0.03}s` }}>
                            <TD>
                              <div className="flex items-center gap-3">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[0.72rem] font-semibold text-text-2 ring-1 ring-inset ring-border">{initialsOf(u.name)}</span>
                                <Cell2 primary={u.name ?? "—"} secondary={<span className="md:hidden">{u.email ?? u.phoneNumber}</span>} />
                              </div>
                            </TD>
                            <TD className="hidden max-w-[240px] truncate text-text-muted md:table-cell">
                              {u.email ?? <span className="text-text-faint">—</span>}
                              {u.phoneNumber && <span className="block text-[0.72rem] tabular-nums text-text-faint">{u.phoneNumber}</span>}
                            </TD>
                            <TD className="hidden max-w-[220px] truncate text-text-muted xl:table-cell">{pages.length === 0 ? <span className="text-text-faint">—</span> : pages.map((p) => `@${p.handle}`).join(", ")}</TD>
                            <TD onClick={(e) => e.stopPropagation()}>
                              <div className="flex flex-col items-start gap-1">
                                <select
                                  value={u.role}
                                  onChange={(e) => roleMutation.mutate({ id: u.id, role: e.target.value as Role })}
                                  disabled={roleMutation.isPending || u.id === user?.id || (!actorIsFullAdmin && u.role === "ADMIN")}
                                  title={
                                    u.id === user?.id
                                      ? "You can't change your own role"
                                      : !actorIsFullAdmin && u.role === "ADMIN"
                                        ? "Only a full admin can change an admin's role"
                                        : "Change role"
                                  }
                                  aria-label={`Role for ${personLabel(u)}`}
                                  className="h-8 w-fit rounded-[6px] border border-border-strong bg-surface px-2 text-[0.78rem] text-text shadow-card focus:border-ink focus:outline-none disabled:opacity-50"
                                >
                                  {ROLES.map((r) => (
                                    <option key={r} value={r} disabled={r === "ADMIN" && !actorIsFullAdmin && u.role !== "ADMIN"}>
                                      {roleLabel(r)}
                                    </option>
                                  ))}
                                </select>
                                {isSubAdmin(u) && <Tag tone="wait">Sub-admin</Tag>}
                                {hasGrantedAccess(u) && <Tag tone="wait">Granted access</Tag>}
                                {hasLimitedAccess(u) && <Tag tone="wait">Limited access</Tag>}
                              </div>
                            </TD>
                            <TD className="hidden whitespace-nowrap text-text-muted xl:table-cell">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</TD>
                            <TD right onClick={(e) => e.stopPropagation()}>
                              <div className="flex flex-col items-end gap-1">
                                {canResetPassword(u) && (
                                  <button type="button" onClick={() => setResettingUser(u)} className="whitespace-nowrap text-[0.75rem] font-medium text-blue hover:text-text">
                                    Reset password
                                  </button>
                                )}
                                {canResetPassword(u) && (
                                  <button type="button" onClick={() => setEmailUser(u)} className="whitespace-nowrap text-[0.75rem] font-medium text-blue hover:text-text">
                                    Change email
                                  </button>
                                )}
                                {u.id !== user?.id && canEditAccess(u) && (
                                  <button type="button" onClick={() => setEditingAccessUser(u)} className="whitespace-nowrap text-[0.75rem] font-medium text-blue hover:text-text">
                                    Edit access
                                  </button>
                                )}
                              </div>
                            </TD>
                          </TR>
                        );
                      })}
                    </tbody>
                  </Table>
                )}
              </Card>

              <div className="hidden lg:block">
                {selected ? (
                  <Card className="flex flex-col" data-testid="person-detail">
                    <CardHeader
                      title={selected.name ?? "—"}
                      meta={<span className="text-[0.78rem] text-text-muted">{roleLabel(selected.role)} · {selected.email ?? selected.phoneNumber ?? "—"}</span>}
                      action={
                        canResetPassword(selected) ? (
                          <div className="flex gap-2">
                            <Button size="sm" variant="secondary" onClick={() => setEmailUser(selected)}>
                              Change email
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setResettingUser(selected)}>
                              Reset password
                            </Button>
                          </div>
                        ) : undefined
                      }
                    />
                    <div className="flex flex-col gap-4 p-[18px]">
                      <div>
                        <p className="mb-2 text-[0.8125rem] font-semibold">Pages</p>
                        {(pagesByOwner.get(selected.id) ?? []).length === 0 ? (
                          <p className="text-[0.8125rem] text-text-muted">No pages yet.</p>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {(pagesByOwner.get(selected.id) ?? []).map((p) => {
                              const reel = p.rateCards.find((r) => r.format === "reel");
                              const story = p.rateCards.find((r) => r.format === "story");
                              return (
                                <div key={p.id} className="flex items-center gap-3 rounded-[10px] border border-border px-3 py-2.5">
                                  <Cell2 primary={`@${p.handle}`} secondary={`${p.category ?? "—"} · ${followersLabel(p.followers)}`} />
                                  <div className="ml-auto text-right">
                                    <p className="text-[0.7rem] text-text-muted">Reel / Story</p>
                                    <p className="text-[0.78rem] font-semibold tabular-nums">
                                      {reel ? money(reel.amount) : "—"} / {story ? money(story.amount) : "—"}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {(selected.permissions || isOwnScopeRole(selected.role)) && (
                        <div>
                          <p className="mb-2 text-[0.8125rem] font-semibold">{isOwnScopeRole(selected.role) ? "Access (own content only)" : "Access"}</p>
                          <AccessSummary value={accessOf(selected)} role={selected.role} />
                          {selected.id !== user?.id && canEditAccess(selected) && (
                            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setEditingAccessUser(selected)}>
                              Edit access
                            </Button>
                          )}
                        </div>
                      )}
                      <p className="text-[0.75rem] text-text-muted">Joined {selected.createdAt ? new Date(selected.createdAt).toLocaleDateString() : "—"}</p>
                    </div>
                  </Card>
                ) : (
                  <Card className="p-8 text-center text-[0.8125rem] text-text-muted">Select a person to see their pages and access.</Card>
                )}
              </div>
            </div>
          </>
        )}

        {roleMutation.isError && <ErrorNotice message={roleMutation.error instanceof ApiError ? roleMutation.error.message : "Couldn't update that user's role."} />}
      </div>

      {showCreate && <CreateUserModal token={token} actorIsFullAdmin={actorIsFullAdmin} onClose={() => setShowCreate(false)} onCreated={() => queryClient.invalidateQueries({ queryKey: ["adminUsers"] })} />}

      {resettingUser && <ResetPasswordModal token={token} targetUser={resettingUser} onClose={() => setResettingUser(null)} />}
      {emailUser && (
        <ChangeEmailModal
          token={token}
          targetUser={emailUser}
          onClose={() => setEmailUser(null)}
          onChanged={() => queryClient.invalidateQueries({ queryKey: ["adminUsers"] })}
        />
      )}

      {editingAccessUser && (
        <EditAccessModal
          token={token}
          targetUser={editingAccessUser}
          onClose={() => setEditingAccessUser(null)}
          onSaved={() => {
            setEditingAccessUser(null);
            queryClient.invalidateQueries({ queryKey: ["adminUsers"] });
          }}
        />
      )}
    </AppShell>
  );
}

/**
 * Permission editing for any account (newTask.md, 8 Sep — "Admin can create
 * Sub-admins, each with a hand-picked selection of what they can
 * see/access"; extended 15 Sep so this same panel works on a Creator/Team
 * member/Finance/Planner row too, not just an ADMIN one — "admin can give
 * any user access permissions"). Every checkbox starts from the target's
 * *current* effective permissions (adminApi.users() already resolves role
 * defaults + overlay — see admin/routes.js), so toggling one box and saving
 * only sends that one key as a change; the server merges it onto the
 * existing overlay rather than replacing the whole thing
 * (admin/service.js's updateUserPermissions).
 */
function EditAccessModal({
  token,
  targetUser,
  onClose,
  onSaved,
}: {
  token: string;
  targetUser: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ownScope = isOwnScopeRole(targetUser.role);
  const [values, setValues] = useState<Permissions>(() => {
    if (ownScope) return accessOf(targetUser);
    const current = targetUser.permissions;
    return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, current?.[k] ?? true])) as Permissions;
  });

  // Own-scope roles: send only their own switches (anything else is a 400 on the server).
  const payload = ownScope ? (Object.fromEntries((OWN_CAPABILITIES[targetUser.role] ?? []).map((k) => [k, values[k]])) as Partial<Permissions>) : values;
  const saveMutation = useMutation({
    mutationFn: () => adminApi.updatePermissions(token, targetUser.id, payload as Permissions),
    onSuccess: onSaved,
  });

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[480px]">
      <div className="flex flex-1 min-h-0 flex-col gap-5 overflow-y-auto p-6 pt-1">
        <div>
          <h2 className="text-lg font-semibold">Edit access</h2>
          <p className="mt-1 text-[0.8125rem] text-text-muted">
            What <strong className="text-text">{personLabel(targetUser)}</strong> can see and do{ownScope ? " — with their own content only" : ""}. Unchecking a
            section hides it and blocks it server-side, even if they still have the link.{" "}
            {ownScope ? "Nothing here can open anyone else's data." : "Check the section to see and toggle its individual actions (edit, approve, pay…)."}
          </p>
        </div>

        <AccessEditor value={values} onChange={setValues} role={targetUser.role} />

        {saveMutation.isError && (
          <ErrorNotice message={saveMutation.error instanceof ApiError ? saveMutation.error.message : "Couldn't save this account's access."} />
        )}

        <div className="flex gap-2.5">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save access"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * newTask.md #8 — "admin will have password of all creators", built as
 * reset-and-reveal (see CLAUDE.md) instead of a stored/recoverable
 * password: this generates a brand new one on the spot and shows it once,
 * same as account creation. Confirms first since it signs the user out
 * everywhere — a plain click-and-done button would be too easy to hit by
 * accident on the wrong row.
 */
function ResetPasswordModal({ token, targetUser, onClose }: { token: string; targetUser: User; onClose: () => void }) {
  const resetMutation = useMutation({
    mutationFn: () => adminApi.resetPassword(token, targetUser.id),
  });

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[420px]">
      <div className="flex flex-col gap-5 overflow-y-auto p-6 pt-1">
        <h2 className="text-lg font-semibold">Reset password</h2>

        {resetMutation.data ? (
          <div className="flex flex-col gap-3">
            <p className="text-[0.8125rem] text-text-muted">
              New password for <strong className="text-text">{personLabel(targetUser)}</strong>. Share it with them now
              — it&apos;s shown only this once and can&apos;t be retrieved again. They&apos;ve been signed out everywhere.
            </p>
            <div className="rounded-md border border-border-strong bg-surface-2 px-3.5 py-3 text-center font-mono text-lg font-semibold tracking-wide">
              {resetMutation.data.generatedPassword}
            </div>
            <Button className="w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <p className="text-[0.8125rem] text-text-muted">
              This generates a new password for <strong className="text-text">{personLabel(targetUser)}</strong> and signs
              them out of every device. Their current password stops working immediately.
            </p>
            {resetMutation.isError && (
              <ErrorNotice message={resetMutation.error instanceof ApiError ? resetMutation.error.message : "Couldn't reset this password."} />
            )}
            <div className="flex gap-2.5">
              <Button variant="ghost" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="danger" className="flex-1" onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}>
                {resetMutation.isPending ? "Resetting…" : "Reset password"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

/**
 * Admin changes a user's email — their login (24 Sep: a typo at creation, or
 * a new inbox). Same gate as Reset password. The new address is unverified
 * until their next sign-in's emailed code, and they're signed out everywhere.
 */
function ChangeEmailModal({ token, targetUser, onClose, onChanged }: { token: string; targetUser: User; onClose: () => void; onChanged: () => void }) {
  const [email, setEmail] = useState(targetUser.email ?? "");
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());
  const unchanged = email.trim().toLowerCase() === (targetUser.email ?? "").toLowerCase();
  const mutation = useMutation({
    mutationFn: () => adminApi.updateUserEmail(token, targetUser.id, email.trim()),
    onSuccess: onChanged,
  });

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[420px]">
      <form
        className="flex flex-col gap-5 overflow-y-auto p-6 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !unchanged) mutation.mutate();
        }}
        data-testid="change-email-form"
      >
        <h2 className="text-lg font-semibold">Change email</h2>
        {mutation.data ? (
          <div className="flex flex-col gap-3">
            <p className="text-[0.8125rem] text-text-muted">
              <strong className="text-text">{personLabel(targetUser)}</strong> now signs in with <strong className="text-text">{mutation.data.email}</strong>. They&apos;ve been
              signed out everywhere; their next sign-in emails a code to the new address, which verifies it. Their password is unchanged.
            </p>
            <Button type="button" className="w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <p className="text-[0.8125rem] text-text-muted">
              The email is how <strong className="text-text">{personLabel(targetUser)}</strong> signs in. Changing it signs them out of every device.
            </p>
            <Field label="Email">
              <TextField type="email" value={email} onChange={setEmail} placeholder="name@gmail.com" aria-label="New email" autoComplete="off" />
            </Field>
            {mutation.isError && <ErrorNotice message={mutation.error instanceof ApiError ? mutation.error.message : "Couldn't change the email."} />}
            <div className="flex gap-2.5">
              <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={!valid || unchanged || mutation.isPending}>
                {mutation.isPending ? "Saving…" : "Change email"}
              </Button>
            </div>
          </>
        )}
      </form>
    </Sheet>
  );
}

interface DraftPage {
  handle: string;
  category: string;
  rates: Record<string, string>;
}

function emptyPage(): DraftPage {
  return { handle: "", category: "", rates: {} };
}

function CreateUserModal({ token, actorIsFullAdmin, onClose, onCreated }: { token: string; actorIsFullAdmin: boolean; onClose: () => void; onCreated: () => void }) {
  // Email is required — it's the new account's login (24 Sep); phone is optional contact info.
  const [email, setEmail] = useState("");
  const [emailBlurred, setEmailBlurred] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("CREATOR");
  // Sub-admin creation (newTask.md, 8 Sep) for ADMIN — starts fully-checked
  // (a plain admin), so only sent to the server once something's actually
  // been unchecked. Granted-access creation (15 Sep) for every other role —
  // starts fully-unchecked there, so only sent once something's actually
  // been checked; either way this account stays indistinguishable from one
  // created before this feature existed unless something was deliberately
  // toggled. Reset whenever Role changes so leftover checks from one role
  // don't silently carry over as a grant on another.
  // Starts at `role`'s own baseline — full for ADMIN, Finance/Planner's
  // usual sections for those roles, all-off for Creator/Team member (whose
  // editor is hidden entirely). Reset whenever Role changes so a leftover
  // toggle from one role doesn't silently carry over as a grant on another.
  const [permissions, setPermissions] = useState<Permissions>(() => ({ ...accessBaseline(role) }));
  useEffect(() => {
    setPermissions({ ...accessBaseline(role) });
  }, [role]);
  const [pages, setPages] = useState<DraftPage[]>([emptyPage()]);
  // Page creation happens after signup succeeds, one request per page — a
  // single bad handle shouldn't roll back the account that was just
  // created, so failures are collected and shown, not thrown (same
  // created-vs-skipped pattern as links' bulk upload).
  const [pageFailures, setPageFailures] = useState<string[]>([]);

  const requiresPage = role === ROLE_REQUIRES_PAGE;
  const validPages = pages.filter((p) => p.handle.trim());
  // What actually gets submitted — not just `validPages`, which stays
  // populated in state even after switching Role away from CREATOR (only
  // the Pages section's *visibility* is gated on requiresPage). Used by
  // both the mutation and the post-submit summary below so they can't
  // disagree about how many pages were attempted.
  const submittedPages = requiresPage ? validPages : [];
  const emailValid = /^\S+@\S+\.\S+$/.test(email.trim());
  const showEmailError = emailBlurred && !emailValid;
  const phoneDigits = phoneNumber.replace(/\D/g, "");
  // Optional — but if typed, it must be a full 10-digit Indian mobile
  // number after the fixed +91 prefix (a partial "123" used to reach the
  // server as "+91123", bugs.md #3). Error only once the field's been left.
  const [phoneBlurred, setPhoneBlurred] = useState(false);
  const phoneValid = phoneDigits.length === 0 || phoneDigits.length === 10;
  const showPhoneError = phoneBlurred && !phoneValid;
  const canSubmit = emailValid && phoneValid && (!requiresPage || validPages.length > 0);

  function updatePage(index: number, patch: Partial<DraftPage>) {
    setPages((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }
  function addPage() {
    setPages((prev) => [...prev, emptyPage()]);
  }
  function removePage(index: number) {
    setPages((prev) => prev.filter((_, i) => i !== index));
  }

  // Only send `permissions` at all once it actually deviates from this
  // role's own baseline — see auth/service.js's signup for the matching
  // server-side default.
  const hasCustomAccess = PERMISSION_KEYS.some((k) => permissions[k] !== accessBaseline(role)[k]);
  // Own-scope roles: only their own switches go to the server.
  const permissionsPayload = isOwnScopeRole(role)
    ? (Object.fromEntries((OWN_CAPABILITIES[role] ?? []).map((k) => [k, permissions[k]])) as Permissions)
    : permissions;

  const createMutation = useMutation({
    mutationFn: async () => {
      const result = await authApi.signup(token, {
        email: email.trim(),
        phoneNumber: phoneDigits ? `+91${phoneDigits}` : undefined,
        name: name || undefined,
        role,
        permissions: hasCustomAccess ? permissionsPayload : undefined,
      });
      const failures: string[] = [];
      for (const page of submittedPages) {
        try {
          const asset = await assetsApi.create(token, page.handle, "instagram", {
            category: page.category || undefined,
            ownerId: result.user.id,
          });
          const rateCards = Object.entries(page.rates)
            .filter(([, amount]) => amount.trim())
            .map(([format, amount]) => ({ format, amount: Number(amount) }));
          if (rateCards.length > 0) await assetsApi.updateRateCard(token, asset.id, rateCards);
        } catch (err) {
          failures.push(`@${page.handle} — ${err instanceof ApiError ? err.message : "couldn't be created"}`);
        }
      }
      setPageFailures(failures);
      return result;
    },
    onSuccess: onCreated,
  });

  const created = createMutation.data;

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[480px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (created) {
            onClose();
            return;
          }
          createMutation.mutate();
        }}
        className="flex flex-1 min-h-0 flex-col gap-5 overflow-y-auto p-6 pt-1"
      >
        <h2 className="text-lg font-semibold">Add a user</h2>

        {created ? (
          <div className="flex flex-col gap-3">
            <p className="text-[0.8125rem] text-text-muted">
              Account created for <strong className="text-text">{created.user.email}</strong>. They sign in with that email and this
              password, then confirm a code sent to the email. Share the password now — it&apos;s shown only this once.
            </p>
            <div className="rounded-md border border-border-strong bg-surface-2 px-3.5 py-3 text-center font-mono text-lg font-semibold tracking-wide">
              {created.generatedPassword}
            </div>
            {submittedPages.length > 0 && (
              <p className="text-[0.8125rem] text-text-muted">
                {submittedPages.length - pageFailures.length} of {submittedPages.length} page{submittedPages.length === 1 ? "" : "s"} created.
              </p>
            )}
            {pageFailures.length > 0 && (
              <ErrorNotice message={`Some pages weren't created: ${pageFailures.join("; ")} — add them from Assets afterward.`} />
            )}
          </div>
        ) : (
          <>
            <Field label="Email">
              <TextField
                type="email"
                required
                value={email}
                onChange={setEmail}
                onBlur={() => setEmailBlurred(true)}
                placeholder="name@gmail.com"
                aria-label="Email"
                autoComplete="off"
              />
              {showEmailError && <p className="text-[0.75rem] text-rose">Enter a valid email address — it&apos;s how they&apos;ll sign in.</p>}
            </Field>
            <Field label="Name (optional)">
              <TextField value={name} onChange={setName} placeholder="Their name" />
            </Field>
            <Field label="Phone (optional)">
              <PhoneField value={phoneNumber} onChange={setPhoneNumber} onBlur={() => setPhoneBlurred(true)} placeholder="98765 43210" error={showPhoneError ? "Enter a valid 10-digit mobile number, or leave it empty." : null} />
            </Field>
            <Field label="Role">
              <Select value={role} onChange={(v) => setRole(v as Role)}>
                {ROLES.map((r) => (
                  // Only a full admin can create an ADMIN account (server:
                  // auth/service.js signup → 403 ADMIN_ACCOUNT_RESTRICTED).
                  <option key={r} value={r} disabled={r === "ADMIN" && !actorIsFullAdmin}>
                    {roleLabel(r)}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <div>
                <p className="text-[0.8125rem] font-semibold">{role === "ADMIN" ? "Access (Sub-admin)" : isOwnScopeRole(role) ? "Access (own content only)" : "Access"}</p>
                <p className="text-[0.75rem] text-text-faint">
                  {role === "ADMIN"
                    ? "Leave everything checked for a full admin. Uncheck a section (or just one of its actions) to create a Sub-admin restricted to the rest."
                    : isOwnScopeRole(role)
                      ? `Everything a ${roleLabel(role)} normally uses is on — uncheck anything they shouldn't have.`
                      : `Starts at a plain ${roleLabel(role)}'s usual access. Check a section, or one of its actions, to grant more.`}
                </p>
              </div>
              <AccessEditor value={permissions} onChange={setPermissions} role={role} />
            </div>

            {requiresPage && (
              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <div>
                  <p className="text-[0.8125rem] font-semibold">Pages</p>
                  <p className="text-[0.75rem] text-text-faint">At least one Instagram page is required for a creator account.</p>
                </div>
                {pages.map((page, i) => (
                  <div key={i} className="flex flex-col gap-2.5 rounded-md border border-border p-3.5">
                    <div className="flex items-center gap-2">
                      <AssetIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                      <input
                        required={i === 0}
                        value={page.handle}
                        onChange={(e) => updatePage(i, { handle: e.target.value })}
                        placeholder="Instagram handle (without @)"
                        className="h-9 flex-1 rounded-md border border-border-strong bg-surface-2 px-2.5 text-[0.8125rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30"
                      />
                      {pages.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePage(i)}
                          aria-label="Remove page"
                          className="shrink-0 text-text-faint hover:text-rose"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <CategoryPicker value={page.category} onChange={(v) => updatePage(i, { category: v })} />
                    <div className="grid grid-cols-2 gap-2">
                      {LINK_FORMATS.map((format) => (
                        <div key={format} className="flex items-center justify-between gap-2">
                          <span className="text-[0.75rem] capitalize text-text-faint">{format}</span>
                          <MoneyField compact value={page.rates[format] ?? ""} onChange={(v) => updatePage(i, { rates: { ...page.rates, [format]: v } })} placeholder="rate" aria-label={`${format} rate`} className="w-28" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addPage}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong py-2 text-[0.8125rem] font-semibold text-text-muted hover:bg-surface-2"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Add another page
                </button>
              </div>
            )}
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
          <Button type="submit" className="flex-1" disabled={createMutation.isPending || (!created && !canSubmit)}>
            {created ? "Done" : createMutation.isPending ? "Creating…" : "Create user"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
