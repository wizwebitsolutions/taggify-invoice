"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField, Select } from "@/components/ui/form-field";
import { CategoryPicker } from "@/components/ui/category-picker";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { PlusIcon, TeamIcon, AssetIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { admin as adminApi, auth as authApi, assets as assetsApi, LINK_FORMATS, ApiError, type User, type Role, type Permissions } from "@/lib/api-client";
import { initialsOf, roleLabel } from "@/lib/format";

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
            <div className="grid min-w-[680px] grid-cols-[2fr_1.5fr_1fr_1fr_1fr] gap-3 border-b border-border px-5 py-3.5">
              <div className="text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-text-faint">Name</div>
              <div className="text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-text-faint">Phone</div>
              <div className="text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-text-faint">Role</div>
              <div className="text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-text-faint">Joined</div>
              <div className="text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-text-faint">Action</div>
            </div>
            {items.map((u) => (
              <div key={u.id} className="grid min-w-[680px] grid-cols-[2fr_1.5fr_1fr_1fr_1fr] items-center gap-3 border-b border-border px-5 py-4 last:border-b-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2">
                    <TeamIcon className="h-4 w-4 text-text-muted" />
                  </div>
                  <span className="truncate text-[0.8438rem] font-semibold">{u.name ?? "—"}</span>
                </div>
                <span className="truncate text-[0.8125rem] text-text-muted">{u.phoneNumber}</span>
                <div className="flex flex-col gap-1">
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
                  {/* Sub-admin (newTask.md, 8 Sep) isn't a separate role — it's
                      an Admin account with at least one permission key turned
                      off. Flag it here so it doesn't read as a plain admin. */}
                  {u.role === "ADMIN" && u.permissions && PERMISSION_KEYS.some((k) => u.permissions![k] === false) && (
                    <span className="w-fit rounded-full bg-accent-2-soft px-2 py-0.5 text-[0.6875rem] font-semibold text-accent-2">Sub-admin</span>
                  )}
                </div>
                <span className="text-xs text-text-faint">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</span>
                <div className="flex flex-col items-start gap-1">
                  <button
                    type="button"
                    onClick={() => setResettingUser(u)}
                    className="w-fit text-[0.75rem] font-semibold text-accent hover:text-accent-2"
                  >
                    Reset password
                  </button>
                  {u.role === "ADMIN" && u.id !== user?.id && (
                    <button
                      type="button"
                      onClick={() => setEditingAccessUser(u)}
                      className="w-fit text-[0.75rem] font-semibold text-accent hover:text-accent-2"
                    >
                      Edit access
                    </button>
                  )}
                </div>
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

      {resettingUser && (
        <ResetPasswordModal token={token} targetUser={resettingUser} onClose={() => setResettingUser(null)} />
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
 * Sub-admin permission editing (newTask.md, 8 Sep — "Admin can create
 * Sub-admins, each with a hand-picked selection of what they can
 * see/access"). Every checkbox starts from the target's *current* effective
 * permissions (adminApi.users() already resolves role defaults + overlay —
 * see admin/routes.js), so unchecking one box and saving only sends that
 * one key as a change; the server merges it onto the existing overlay
 * rather than replacing the whole thing (admin/service.js's updateUserPermissions).
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
          <h2 className="text-lg font-bold">Edit access</h2>
          <p className="mt-1 text-[0.8125rem] text-text-muted">
            What <strong className="text-text">{targetUser.name ?? targetUser.phoneNumber}</strong> can see and do. Unchecking a section
            hides it and blocks its actions server-side, even if they still have the link.
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
        <h2 className="text-lg font-bold">Reset password</h2>

        {resetMutation.data ? (
          <div className="flex flex-col gap-3">
            <p className="text-[0.8125rem] text-text-muted">
              New password for <strong className="text-text">{targetUser.name ?? targetUser.phoneNumber}</strong>. Share it with them now
              — it&apos;s shown only this once and can&apos;t be retrieved again. They&apos;ve been signed out everywhere.
            </p>
            <div className="rounded-md border border-border-strong bg-surface-2 px-3.5 py-3 text-center font-mono text-lg font-bold tracking-wide">
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
  // Sub-admin creation (newTask.md, 8 Sep) — only reachable/relevant when
  // role is ADMIN; starts fully-checked (a plain admin), so only sent to
  // the server at all once something's actually been unchecked (see
  // createMutation below) — otherwise this account is indistinguishable
  // from an admin created before this feature existed.
  const [permissions, setPermissions] = useState<Record<keyof Permissions, boolean>>(
    () => Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true])) as Record<keyof Permissions, boolean>
  );
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

  const isRestrictedAdmin = role === "ADMIN" && PERMISSION_KEYS.some((k) => !permissions[k]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const result = await authApi.signup(token, {
        phoneNumber: `+91${phoneDigits}`,
        name: name || undefined,
        role,
        permissions: isRestrictedAdmin ? permissions : undefined,
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
              <div
                className={cn(
                  "flex h-11 items-center gap-2 rounded-md border bg-surface-2 px-3.5 focus-within:ring-2 focus-within:ring-accent",
                  showPhoneError ? "border-rose" : "border-border-strong"
                )}
              >
                <span className="text-[0.9375rem] text-text-faint">+91</span>
                <input
                  required
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  onBlur={() => setPhoneBlurred(true)}
                  placeholder="98765 43210"
                  aria-invalid={showPhoneError}
                  className="w-full bg-transparent text-[0.9375rem] text-text placeholder:text-text-faint focus:outline-none"
                />
              </div>
              {showPhoneError && <p className="mt-1 text-[0.75rem] text-rose">Enter a valid 10-digit mobile number.</p>}
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

            {role === "ADMIN" && (
              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <div>
                  <p className="text-[0.8125rem] font-semibold">Access (Sub-admin)</p>
                  <p className="text-[0.75rem] text-text-faint">
                    Leave everything checked for a full admin. Uncheck a section to create a Sub-admin restricted to the rest.
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
            )}

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
                        className="h-9 flex-1 rounded-md border border-border-strong bg-surface-2 px-2.5 text-[0.8125rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
                          <input
                            type="number"
                            min={0}
                            value={page.rates[format] ?? ""}
                            onChange={(e) => updatePage(i, { rates: { ...page.rates, [format]: e.target.value } })}
                            placeholder="₹ rate"
                            className="h-7 w-20 rounded-md border border-border-strong bg-surface-2 px-2 text-right text-[0.75rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          />
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
