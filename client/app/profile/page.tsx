"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField, PhoneField, FieldError, VALIDATORS, digitsOnly } from "@/components/ui/form-field";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { LogoutIcon, CheckIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { users as usersApi, auth as authApi, billing as billingApi, ApiError, type User, type BillingProfile } from "@/lib/api-client";
import { initialsOf, roleLabel } from "@/lib/format";

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileContent />
    </RequireAuth>
  );
}

function ProfileContent() {
  const { user, accessToken, logout } = useAuth();
  // /profile?tab=billing deep-links straight to the billing tab — the admin
  // dashboard's "Billing profiles awaiting approval" card links here.
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"profile" | "billing">(searchParams.get("tab") === "billing" ? "billing" : "profile");
  const token = accessToken!;

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => usersApi.me(token) });

  return (
    <AppShell
      active="profile"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search…"
    >
      <div className="flex max-w-[720px] flex-col gap-7">
        <div>
          <p className="mb-1 text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">Account</p>
          <h1 className="mb-1 text-[1.5rem] font-semibold leading-tight tracking-[-0.03em] md:text-[1.625rem]">Profile</h1>
          <p className="max-w-[56ch] text-[0.875rem] text-text-muted">Your details, contact info, and billing identity.</p>
        </div>

        <div className="flex gap-1 border-b border-border">
          {(["profile", "billing"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "-mb-px border-b-2 px-4 py-2.5 text-[0.875rem] font-semibold capitalize",
                tab === t ? "border-ink text-text" : "border-transparent text-text-faint hover:text-text-muted"
              )}
            >
              {t === "billing" ? "Billing profiles" : "Profile"}
            </button>
          ))}
        </div>

        {meQuery.isLoading ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <TableSkeleton />
          </div>
        ) : !meQuery.data ? null : tab === "profile" ? (
          <ProfileTab token={token} me={meQuery.data} />
        ) : (
          <BillingTab token={token} isReviewer={user?.role === "ADMIN" || user?.role === "FINANCE"} />
        )}

        {/* Desktop carries log out in the topbar (hidden below md) — the mobile "More" sheet has its own, but it lives here too since this is the account page. */}
        <Button variant="danger" size="lg" className="w-full md:hidden" onClick={logout}>
          <LogoutIcon className="h-3.5 w-3.5" />
          Log out
        </Button>
      </div>
    </AppShell>
  );
}

function ProfileTab({ token, me }: { token: string; me: User }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.name ?? "");
  const [email, setEmail] = useState(me.email ?? "");
  const emailLocked = Boolean(me.emailVerifiedAt);
  const [secondaryPhone, setSecondaryPhone] = useState((me.secondaryPhone ?? "").replace(/^\+91/, "").replace(/\D/g, "").slice(0, 10));
  const [addressLine1, setAddressLine1] = useState(me.addressLine1 ?? "");
  const [addressLine2, setAddressLine2] = useState(me.addressLine2 ?? "");
  const [state, setState] = useState(me.state ?? "");
  const [pincode, setPincode] = useState(me.pincode ?? "");

  const saveMutation = useMutation({
    mutationFn: () => {
      // Omit blank fields rather than sending "" — they're optional server-side
      // but validated (e.g. secondaryPhone min length) when present at all.
      const body = Object.fromEntries(
        Object.entries({ name, email: emailLocked ? "" : email, secondaryPhone: secondaryPhone ? `+91${secondaryPhone}` : "", addressLine1, addressLine2, state, pincode }).filter(([, v]) => v !== "")
      );
      return usersApi.updateProfile(token, body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-card">
        <h2 className="text-[0.9375rem] font-semibold">Contact details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name">
            <TextField value={name} onChange={setName} placeholder="Your name" />
          </Field>
          <Field label="Phone (registered)">
            <TextField value={me.phoneNumber ?? ""} placeholder="Not added" onChange={() => {}} disabled className="opacity-60" />
          </Field>
          {/* Once verified, the email is the sign-in identifier (email 2FA,
              21 Sep) and the server refuses to change it from here — show it
              the same locked way as the registered phone. */}
          {emailLocked ? (
            <Field label="Email (verified — used to sign in)">
              <TextField type="email" value={email} onChange={() => {}} disabled className="opacity-60" />
            </Field>
          ) : (
            <Field label="Email">
              <TextField type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
              <FieldError message={VALIDATORS.email(email)} />
            </Field>
          )}
          <Field label="Secondary phone">
            <PhoneField value={secondaryPhone} onChange={setSecondaryPhone} placeholder="For WhatsApp invoice alerts" />
          </Field>
        </div>

        <div className="border-t border-border pt-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">Address</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Address line 1">
              <TextField value={addressLine1} onChange={setAddressLine1} />
            </Field>
            <Field label="Address line 2">
              <TextField value={addressLine2} onChange={setAddressLine2} />
            </Field>
            <Field label="State">
              <TextField value={state} onChange={setState} />
            </Field>
            <Field label="Pincode">
              <TextField inputMode="numeric" maxLength={6} value={pincode} onChange={(v) => setPincode(digitsOnly(v, 6))} />
            </Field>
          </div>
        </div>

        {saveMutation.isError && (
          <ErrorNotice message={saveMutation.error instanceof ApiError ? saveMutation.error.message : "Couldn't save your profile."} />
        )}
        {saveMutation.isSuccess && <p className="text-[0.8125rem] font-semibold text-accent">Saved.</p>}

        <Button className="self-start" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <ChangePasswordCard token={token} />
    </div>
  );
}

function ChangePasswordCard({ token }: { token: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const rules = [
    { label: "8+ characters", ok: newPassword.length >= 8 },
    { label: "One uppercase letter", ok: /[A-Z]/.test(newPassword) },
    { label: "One lowercase letter", ok: /[a-z]/.test(newPassword) },
    { label: "One number", ok: /[0-9]/.test(newPassword) },
    { label: "One special character", ok: /[^a-zA-Z0-9]/.test(newPassword) },
  ];

  const changeMutation = useMutation({
    mutationFn: () => authApi.changePassword(token, currentPassword, newPassword),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
    },
  });

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-card">
      <div>
        <h2 className="text-[0.9375rem] font-semibold">Change password</h2>
        <p className="mt-1 text-[0.8125rem] text-text-faint">Let&apos;s make sure your password is strong.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Current password">
          <TextField type="password" value={currentPassword} onChange={setCurrentPassword} />
        </Field>
        <Field label="New password">
          <TextField type="password" value={newPassword} onChange={setNewPassword} />
        </Field>
      </div>

      <ul className="flex flex-col gap-1.5">
        {rules.map((r) => (
          <li key={r.label} className={cn("flex items-center gap-2 text-[0.8125rem]", r.ok ? "text-accent" : "text-text-faint")}>
            {r.ok ? (
              <CheckIcon className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <span className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-border-strong" />
            )}
            {r.label}
          </li>
        ))}
      </ul>

      {changeMutation.isError && (
        <ErrorNotice message={changeMutation.error instanceof ApiError ? changeMutation.error.message : "Couldn't change your password."} />
      )}
      {changeMutation.isSuccess && <p className="text-[0.8125rem] font-semibold text-accent">Password changed.</p>}

      <Button
        className="self-start"
        onClick={() => changeMutation.mutate()}
        disabled={changeMutation.isPending || !currentPassword || rules.some((r) => !r.ok)}
      >
        {changeMutation.isPending ? "Changing…" : "Change password"}
      </Button>
    </div>
  );
}

/**
 * Billing profiles (user request, 22 Sep — "admin can [add a] billing
 * profile for himself as well ... and can edit billing details for any
 * profile ... show list of name, number, and on the right on selection
 * show all details of billings"). A reviewer (Admin / Finance) gets a
 * master–detail view: every account with a profile on the left (their own
 * account always first, even with none yet), the selected account's
 * profiles — every field, Edit, Approve/Reject — on the right. Everyone
 * else keeps the plain list of their own profiles, now with Edit.
 */
function BillingTab({ token, isReviewer }: { token: string; isReviewer: boolean }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BillingProfile | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const profilesQuery = useQuery({ queryKey: ["billingProfiles"], queryFn: () => billingApi.list(token) });
  const items = profilesQuery.data ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["billingProfiles"] });

  const approvalMutation = useMutation({
    mutationFn: ({ id, approvalStatus }: { id: string; approvalStatus: BillingProfile["approvalStatus"] }) =>
      billingApi.setApproval(token, id, approvalStatus),
    onSuccess: refresh,
  });

  // One row per account, the signed-in user's own first (so an admin can
  // add their own even with none yet), then the rest by name.
  const accounts = useMemo(() => {
    const byUser = new Map<string, { id: string; name: string | null; phoneNumber: string | null; email?: string | null; profiles: BillingProfile[] }>();
    if (user) byUser.set(user.id, { id: user.id, name: user.name, phoneNumber: user.phoneNumber, email: user.email, profiles: [] });
    for (const bp of items) {
      const u = bp.user ?? { id: bp.userId, name: null, phoneNumber: null };
      if (!byUser.has(u.id)) byUser.set(u.id, { ...u, profiles: [] });
      byUser.get(u.id)!.profiles.push(bp);
    }
    const [me, ...rest] = [...byUser.values()].sort((a, b) => Number(b.id === user?.id) - Number(a.id === user?.id) || (a.name ?? "").localeCompare(b.name ?? ""));
    return me ? [me, ...rest] : rest;
  }, [items, user]);
  const selected = accounts.find((a) => a.id === (selectedUserId ?? user?.id)) ?? accounts[0] ?? null;
  const selectedIsMe = selected?.id === user?.id;
  const shownProfiles = isReviewer ? (selected?.profiles ?? []) : items;

  const modals = (
    <>
      {showForm && (
        <BillingProfileModal
          token={token}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            refresh();
          }}
        />
      )}
      {editing && (
        <BillingProfileModal
          token={token}
          profile={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </>
  );

  const profileCards = (list: BillingProfile[]) =>
    list.map((bp) => (
      <div key={bp.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-card" data-testid={`billing-profile-${bp.id}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.9375rem] font-semibold">
              {bp.pan} — {bp.name}
            </p>
            {isReviewer && bp.user && (
              <p className="mt-0.5 text-xs text-text-faint">
                {bp.user.name ?? "—"} · {bp.user.email ?? bp.user.phoneNumber ?? "—"}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold",
                bp.approvalStatus === "approved" ? "bg-accent-soft text-accent" : bp.approvalStatus === "rejected" ? "bg-rose-soft text-rose" : "bg-slate-soft text-slate"
              )}
            >
              {bp.approvalStatus}
            </span>
            <Button size="sm" variant="secondary" onClick={() => setEditing(bp)} aria-label={`Edit billing profile ${bp.pan}`}>
              Edit
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 text-[0.8125rem] sm:grid-cols-2">
          <div>
            <p className="text-xs text-text-faint">GSTIN</p>
            <p className="font-medium">{bp.gstin || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-text-faint">MSME</p>
            <p className="font-medium">{bp.msme || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-text-faint">Bank account number</p>
            <p className="font-medium">{bp.bankAccountNumber}</p>
          </div>
          <div>
            <p className="text-xs text-text-faint">IFSC code</p>
            <p className="font-medium">{bp.ifscCode}</p>
          </div>
        </div>
        {isReviewer && bp.approvalStatus === "pending" && (
          <div className="flex gap-2 border-t border-border pt-3">
            <Button size="sm" className="flex-1" onClick={() => approvalMutation.mutate({ id: bp.id, approvalStatus: "approved" })} disabled={approvalMutation.isPending}>
              Approve
            </Button>
            <Button variant="danger" size="sm" className="flex-1" onClick={() => approvalMutation.mutate({ id: bp.id, approvalStatus: "rejected" })} disabled={approvalMutation.isPending}>
              Reject
            </Button>
          </div>
        )}
      </div>
    ));

  if (!isReviewer) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-[0.8125rem] text-text-faint">Add at least one approved billing profile to receive payments and raise invoices. Each PAN can only be registered once.</p>
          <Button size="sm" onClick={() => setShowForm(true)}>
            Add billing profile
          </Button>
        </div>
        {profilesQuery.isLoading ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <TableSkeleton />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <EmptyState label="No billing profiles yet." />
          </div>
        ) : (
          <div className="flex flex-col gap-3">{profileCards(items)}</div>
        )}
        {modals}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[0.8125rem] text-text-faint">Every account's billing profiles — pick one on the left to see, edit or approve its details. Your own is first.</p>
      {profilesQuery.isLoading ? (
        <div className="rounded-lg border border-border bg-surface shadow-card">
          <TableSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
          <ul className="flex max-h-[520px] flex-col overflow-y-auto rounded-lg border border-border bg-surface shadow-card" aria-label="Accounts with billing profiles" data-testid="billing-accounts">
            {accounts.map((a) => {
              const active = a.id === selected?.id;
              const pending = a.profiles.filter((p) => p.approvalStatus === "pending").length;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedUserId(a.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn("flex w-full items-center justify-between gap-2 border-b border-border px-4 py-3 text-left last:border-b-0", active ? "bg-accent-soft" : "hover:bg-surface-2")}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[0.875rem] font-semibold">{a.id === user?.id ? `${a.name ?? "You"} (you)` : (a.name ?? "—")}</p>
                      <p className="truncate text-[0.75rem] text-text-faint">{a.email ?? a.phoneNumber ?? "—"}</p>
                    </div>
                    <span className="shrink-0 text-[0.6875rem] text-text-faint">
                      {pending > 0 ? <span className="rounded-full bg-slate-soft px-2 py-0.5 font-semibold text-slate">{pending} pending</span> : `${a.profiles.length}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-3" data-testid="billing-detail">
            {selected && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-[0.8125rem] text-text-muted">
                  <span className="font-semibold text-text">{selectedIsMe ? "Your billing profiles" : (selected.name ?? selected.email ?? selected.phoneNumber)}</span>
                  {!selectedIsMe && (selected.email ?? selected.phoneNumber) && ` · ${selected.email ?? selected.phoneNumber}`}
                </p>
                {selectedIsMe && (
                  <Button size="sm" onClick={() => setShowForm(true)}>
                    Add billing profile
                  </Button>
                )}
              </div>
            )}
            {shownProfiles.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface shadow-card">
                <EmptyState label={selectedIsMe ? "You have no billing profile yet — add one to be paid like any creator." : "No billing profiles for this account."} />
              </div>
            ) : (
              profileCards(shownProfiles)
            )}
          </div>
        </div>
      )}
      {modals}
    </div>
  );
}

/** Add (no `profile`) or edit (with one) a billing profile — same form, prefilled for an edit. */
function BillingProfileModal({ token, profile, onClose, onSaved }: { token: string; profile?: BillingProfile; onClose: () => void; onSaved: () => void }) {
  const [pan, setPan] = useState(profile?.pan ?? "");
  const [name, setName] = useState(profile?.name ?? "");
  const [gstin, setGstin] = useState(profile?.gstin ?? "");
  const [msme, setMsme] = useState(profile?.msme ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(profile?.bankAccountNumber ?? "");
  const [ifscCode, setIfscCode] = useState(profile?.ifscCode ?? "");

  const createMutation = useMutation({
    mutationFn: () =>
      profile
        ? billingApi.update(token, profile.id, { pan: pan.toUpperCase(), name, gstin: gstin || null, msme: msme || null, bankAccountNumber, ifscCode: ifscCode.toUpperCase() })
        : billingApi.create(token, { pan: pan.toUpperCase(), name, gstin: gstin || undefined, msme: msme || undefined, bankAccountNumber, ifscCode: ifscCode.toUpperCase() }),
    onSuccess: onSaved,
  });

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[460px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="flex flex-col gap-5 overflow-y-auto p-6 pt-1"
        data-testid="billing-profile-form"
      >
        <h2 className="text-lg font-semibold">{profile ? `Edit billing profile — ${profile.pan}` : "Add a billing profile"}</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="PAN">
            <TextField required value={pan} onChange={(v) => setPan(v.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="ABCDE1234F" maxLength={10} aria-label="PAN" />
            <FieldError message={pan ? VALIDATORS.pan(pan) : null} />
          </Field>
          <Field label="Name on PAN">
            <TextField required value={name} onChange={setName} aria-label="Name on PAN" />
          </Field>
          <Field label="GSTIN (optional)">
            <TextField value={gstin} onChange={(v) => setGstin(v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15))} placeholder="27ABCDE1234F1Z5" maxLength={15} aria-label="GSTIN" />
            <FieldError message={VALIDATORS.gstin(gstin)} />
          </Field>
          <Field label="MSME number (optional)">
            <TextField value={msme} onChange={setMsme} />
          </Field>
          <Field label="Bank account number">
            <TextField required inputMode="numeric" value={bankAccountNumber} onChange={(v) => setBankAccountNumber(digitsOnly(v, 18))} maxLength={18} aria-label="Bank account number" />
            <FieldError message={bankAccountNumber ? VALIDATORS.bankAccount(bankAccountNumber) : null} />
          </Field>
          <Field label="IFSC code">
            <TextField required value={ifscCode} onChange={(v) => setIfscCode(v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11))} placeholder="HDFC0001234" maxLength={11} aria-label="IFSC code" />
            <FieldError message={ifscCode ? VALIDATORS.ifsc(ifscCode) : null} />
          </Field>
        </div>

        {createMutation.isError && (
          <ErrorNotice message={createMutation.error instanceof ApiError ? createMutation.error.message : `Couldn't ${profile ? "save" : "add"} this billing profile.`} />
        )}

        <div className="flex gap-2.5">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={createMutation.isPending || Boolean(VALIDATORS.pan(pan) || VALIDATORS.gstin(gstin) || VALIDATORS.ifsc(ifscCode) || VALIDATORS.bankAccount(bankAccountNumber)) || !name.trim()}>
            {createMutation.isPending ? (profile ? "Saving…" : "Adding…") : profile ? "Save changes" : "Add profile"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
