"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
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
import { admin as adminApi, auth as authApi, assets as assetsApi, LINK_FORMATS, ApiError, hasAccess, type User, type Role, type Permissions, type Asset } from "@/lib/api-client";
import { initialsOf, roleLabel, money, compactNumber } from "@/lib/format";

const ROLES: Role[] = ["CREATOR", "TEAM_MEMBER", "ADMIN", "FINANCE", "PLAN_MAKER"];

// Sub-admin permission overlay (newTask.md, 8 Sep) — one checkbox per
// server-side key (lib/permissions.js), labeled by the section it actually
// gates rather than the raw key name.
const PERMISSION_LABELS: Record<keyof Permissions, string> = {
  "users.manage": "Users — create accounts, change roles, reset passwords",
  "campaigns.manage": "Campaigns — create/edit, phases, sheet import",
  "inventory.manage": "Inventory — add pages, approve, rate cards",
  "links.review": "Link review — screenshots, insights, cost revisions",
  "finance.manage": "Finance — invoices, billing approvals, finance export",
  "plans.manage": "Plans — create/edit/approve any plan",
};
const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS) as (keyof Permissions)[];

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
  const [editingAccessUser, setEditingAccessUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Role | "ALL">("CREATOR");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const token = accessToken!;
  // "Admin" in the loose sense of "can manage People" — a plain ADMIN by
  // default, or (15 Sep) any other role explicitly granted users.manage.
  const isAdmin = hasAccess(user, "users.manage");

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
    return items.filter((u) => tab === "ALL" || u.role === tab).filter((u) => !q || (u.name ?? "").toLowerCase().includes(q) || u.phoneNumber.includes(q));
  }, [items, tab, search]);
  const selected = visible.find((u) => u.id === selectedId) ?? null;

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => adminApi.updateUserRole(token, id, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["adminUsers"] }),
  });

  const isSubAdmin = (u: User) => u.role === "ADMIN" && !!u.permissions && PERMISSION_KEYS.some((k) => u.permissions![k] === false);
  // The non-ADMIN counterpart (15 Sep) — a Creator/Team member/Finance/
  // Planner whose overlay turns at least one of the six sections on.
  const hasGrantedAccess = (u: User) => u.role !== "ADMIN" && !!u.permissions && PERMISSION_KEYS.some((k) => u.permissions![k] === true);

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
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or phone" aria-label="Search users" className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[0.8125rem] shadow-card placeholder:text-text-faint focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink-10" />
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
                        <TH className="hidden md:table-cell">Phone</TH>
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
                                <Cell2 primary={u.name ?? "—"} secondary={<span className="md:hidden">{u.phoneNumber}</span>} />
                              </div>
                            </TD>
                            <TD className="hidden whitespace-nowrap tabular-nums text-text-muted md:table-cell">{u.phoneNumber}</TD>
                            <TD className="hidden max-w-[220px] truncate text-text-muted xl:table-cell">{pages.length === 0 ? <span className="text-text-faint">—</span> : pages.map((p) => `@${p.handle}`).join(", ")}</TD>
                            <TD onClick={(e) => e.stopPropagation()}>
                              <div className="flex flex-col items-start gap-1">
                                <select
                                  value={u.role}
                                  onChange={(e) => roleMutation.mutate({ id: u.id, role: e.target.value as Role })}
                                  disabled={roleMutation.isPending || u.id === user?.id}
                                  title={u.id === user?.id ? "You can't change your own role" : "Change role"}
                                  className="h-8 w-fit rounded-[6px] border border-border-strong bg-surface px-2 text-[0.78rem] text-text shadow-card focus:border-ink focus:outline-none disabled:opacity-50"
                                >
                                  {ROLES.map((r) => (
                                    <option key={r} value={r}>
                                      {roleLabel(r)}
                                    </option>
                                  ))}
                                </select>
                                {isSubAdmin(u) && <Tag tone="wait">Sub-admin</Tag>}
                                {hasGrantedAccess(u) && <Tag tone="wait">Granted access</Tag>}
                              </div>
                            </TD>
                            <TD className="hidden whitespace-nowrap text-text-muted xl:table-cell">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</TD>
                            <TD right onClick={(e) => e.stopPropagation()}>
                              <div className="flex flex-col items-end gap-1">
                                <button type="button" onClick={() => setResettingUser(u)} className="whitespace-nowrap text-[0.75rem] font-medium text-blue hover:text-text">
                                  Reset password
                                </button>
                                {u.id !== user?.id && (
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
                      meta={<span className="text-[0.78rem] text-text-muted">{roleLabel(selected.role)} · {selected.phoneNumber}</span>}
                      action={
                        <Button size="sm" variant="secondary" onClick={() => setResettingUser(selected)}>
                          Reset password
                        </Button>
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
                                  <Cell2 primary={`@${p.handle}`} secondary={`${p.category ?? "—"} · ${compactNumber(p.followers)}`} />
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
                      {selected.permissions && (
                        <div>
                          <p className="mb-2 text-[0.8125rem] font-semibold">Permissions</p>
                          <div className="flex flex-col gap-1.5">
                            {PERMISSION_KEYS.map((k) => (
                              <div key={k} className="flex items-center justify-between text-[0.8125rem]">
                                <span className="text-text-2">{PERMISSION_LABELS[k].split(" — ")[0]}</span>
                                <span className={cn("h-5 w-9 rounded-full", selected.permissions![k] ? "bg-ink" : "bg-border-strong")} aria-label={selected.permissions![k] ? "on" : "off"} />
                              </div>
                            ))}
                          </div>
                          {selected.id !== user?.id && (
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

      {showCreate && <CreateUserModal token={token} onClose={() => setShowCreate(false)} onCreated={() => queryClient.invalidateQueries({ queryKey: ["adminUsers"] })} />}

      {resettingUser && <ResetPasswordModal token={token} targetUser={resettingUser} onClose={() => setResettingUser(null)} />}

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
  const [values, setValues] = useState<Record<keyof Permissions, boolean>>(() => {
    const current = targetUser.permissions;
    return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, current?.[k] ?? true])) as Record<keyof Permissions, boolean>;
  });

  const saveMutation = useMutation({
    mutationFn: () => adminApi.updatePermissions(token, targetUser.id, values),
    onSuccess: onSaved,
  });

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[480px]">
      <div className="flex flex-1 min-h-0 flex-col gap-5 overflow-y-auto p-6 pt-1">
        <div>
          <h2 className="text-lg font-semibold">Edit access</h2>
          <p className="mt-1 text-[0.8125rem] text-text-muted">
            What <strong className="text-text">{targetUser.name ?? targetUser.phoneNumber}</strong> can see and do. Checking a section grants
            it, unchecking hides it and blocks its actions server-side, even if they still have the link.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {PERMISSION_KEYS.map((key) => (
            <label key={key} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-surface-2">
              <input
                type="checkbox"
                checked={values[key]}
                onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.checked }))}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
              />
              <span className="text-[0.8125rem] text-text">{PERMISSION_LABELS[key]}</span>
            </label>
          ))}
        </div>

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
              New password for <strong className="text-text">{targetUser.name ?? targetUser.phoneNumber}</strong>. Share it with them now
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
              This generates a new password for <strong className="text-text">{targetUser.name ?? targetUser.phoneNumber}</strong> and signs
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

interface DraftPage {
  handle: string;
  category: string;
  rates: Record<string, string>;
}

function emptyPage(): DraftPage {
  return { handle: "", category: "", rates: {} };
}

function CreateUserModal({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: () => void }) {
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
  const [permissions, setPermissions] = useState<Record<keyof Permissions, boolean>>(
    () => Object.fromEntries(PERMISSION_KEYS.map((k) => [k, role === "ADMIN"])) as Record<keyof Permissions, boolean>
  );
  useEffect(() => {
    setPermissions(Object.fromEntries(PERMISSION_KEYS.map((k) => [k, role === "ADMIN"])) as Record<keyof Permissions, boolean>);
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
  const phoneDigits = phoneNumber.replace(/\D/g, "");
  // Indian mobile numbers are 10 digits after the fixed +91 prefix (see
  // system design.md's phone-only auth model). canSubmit used to only check
  // "non-empty", so e.g. "123" silently reached the server as "+91123" and
  // failed there with a generic error instead of a clear one here — see
  // bugs.md #3.
  const [phoneBlurred, setPhoneBlurred] = useState(false);
  const phoneValid = phoneDigits.length === 10;
  // Only surface the error once the field's been left (blur), not on every
  // keystroke — otherwise typing a correct number one digit at a time shows
  // an "invalid" state for all 9 digits before it.
  const showPhoneError = phoneBlurred && !phoneValid;
  const canSubmit = phoneValid && (!requiresPage || validPages.length > 0);

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
  // role's own baseline (ADMIN: everything true; every other role:
  // everything false) — see auth/service.js's signup for the matching
  // server-side default.
  const hasCustomAccess =
    role === "ADMIN" ? PERMISSION_KEYS.some((k) => !permissions[k]) : PERMISSION_KEYS.some((k) => permissions[k]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const result = await authApi.signup(token, {
        phoneNumber: `+91${phoneDigits}`,
        name: name || undefined,
        role,
        permissions: hasCustomAccess ? permissions : undefined,
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
              Account created for <strong className="text-text">{created.user.phoneNumber}</strong>. Share this password with them now —
              it&apos;s shown only this once and can&apos;t be retrieved again.
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
            <Field label="Phone number">
              <PhoneField required value={phoneNumber} onChange={setPhoneNumber} onBlur={() => setPhoneBlurred(true)} placeholder="98765 43210" error={showPhoneError ? "Enter a valid 10-digit mobile number." : null} />
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

            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <div>
                <p className="text-[0.8125rem] font-semibold">{role === "ADMIN" ? "Access (Sub-admin)" : "Access (optional)"}</p>
                <p className="text-[0.75rem] text-text-faint">
                  {role === "ADMIN"
                    ? "Leave everything checked for a full admin. Uncheck a section to create a Sub-admin restricted to the rest."
                    : `Leave everything unchecked for a plain ${roleLabel(role)}. Check a section to also grant that admin page.`}
                </p>
              </div>
              {PERMISSION_KEYS.map((key) => (
                <label key={key} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={permissions[key]}
                    onChange={(e) => setPermissions((prev) => ({ ...prev, [key]: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  />
                  <span className="text-[0.8125rem] text-text">{PERMISSION_LABELS[key]}</span>
                </label>
              ))}
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
