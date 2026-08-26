"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Field, TextField } from "@/components/ui/form-field";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
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
  const { user, accessToken } = useAuth();
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
          <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">Account</p>
          <h1 className="mb-1.5 text-[1.625rem] font-bold">Profile</h1>
          <p className="text-[0.9375rem] text-text-muted">Your details, contact info, and billing identity.</p>
        </div>

        <div className="flex gap-1 border-b border-border">
          {(["profile", "billing"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "-mb-px border-b-2 px-4 py-2.5 text-[0.875rem] font-semibold capitalize",
                tab === t ? "border-accent text-accent" : "border-transparent text-text-faint hover:text-text-muted"
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
      </div>
    </AppShell>
  );
}

function ProfileTab({ token, me }: { token: string; me: User }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.name ?? "");
  const [email, setEmail] = useState(me.email ?? "");
  const [secondaryPhone, setSecondaryPhone] = useState(me.secondaryPhone ?? "");
  const [addressLine1, setAddressLine1] = useState(me.addressLine1 ?? "");
  const [addressLine2, setAddressLine2] = useState(me.addressLine2 ?? "");
  const [state, setState] = useState(me.state ?? "");
  const [pincode, setPincode] = useState(me.pincode ?? "");

  const saveMutation = useMutation({
    mutationFn: () => {
      // Omit blank fields rather than sending "" — they're optional server-side
      // but validated (e.g. secondaryPhone min length) when present at all.
      const body = Object.fromEntries(
        Object.entries({ name, email, secondaryPhone, addressLine1, addressLine2, state, pincode }).filter(([, v]) => v !== "")
      );
      return usersApi.updateProfile(token, body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-card">
        <h2 className="text-[0.9375rem] font-bold">Contact details</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name">
            <TextField value={name} onChange={setName} placeholder="Your name" />
          </Field>
          <Field label="Phone (registered)">
            <TextField value={me.phoneNumber} onChange={() => {}} disabled className="opacity-60" />
          </Field>
          <Field label="Email">
            <TextField type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
          </Field>
          <Field label="Secondary phone">
            <TextField value={secondaryPhone} onChange={setSecondaryPhone} placeholder="For WhatsApp invoice alerts" />
          </Field>
        </div>

        <div className="border-t border-border pt-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.06em] text-text-faint">Address</p>
          <div className="grid grid-cols-2 gap-4">
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
              <TextField value={pincode} onChange={setPincode} />
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
        <h2 className="text-[0.9375rem] font-bold">Change password</h2>
        <p className="mt-1 text-[0.8125rem] text-text-faint">Let&apos;s make sure your password is strong.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Current password">
          <TextField type="password" value={currentPassword} onChange={setCurrentPassword} />
        </Field>
        <Field label="New password">
          <TextField type="password" value={newPassword} onChange={setNewPassword} />
        </Field>
      </div>

      <ul className="flex flex-col gap-1">
        {rules.map((r) => (
          <li key={r.label} className={cn("text-[0.8125rem]", r.ok ? "text-accent" : "text-text-faint")}>
            {r.ok ? "✓" : "·"} {r.label}
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

function BillingTab({ token, isReviewer }: { token: string; isReviewer: boolean }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const profilesQuery = useQuery({ queryKey: ["billingProfiles"], queryFn: () => billingApi.list(token) });
  const items = profilesQuery.data ?? [];

  const approvalMutation = useMutation({
    mutationFn: ({ id, approvalStatus }: { id: string; approvalStatus: BillingProfile["approvalStatus"] }) =>
      billingApi.setApproval(token, id, approvalStatus),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["billingProfiles"] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[0.8125rem] text-text-faint">
          {isReviewer
            ? "Every creator's billing profile, for approval."
            : "Add at least one approved billing profile to receive payments and raise invoices. Each PAN can only be registered once."}
        </p>
        {!isReviewer && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            Add billing profile
          </Button>
        )}
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
        <div className="flex flex-col gap-3">
          {items.map((bp) => (
            <div key={bp.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-card">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[0.9375rem] font-bold">
                    {bp.pan} — {bp.name}
                  </p>
                  {isReviewer && bp.user && (
                    <p className="mt-0.5 text-xs text-text-faint">
                      {bp.user.name ?? "—"} · {bp.user.phoneNumber}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[0.6875rem] font-bold",
                    bp.approvalStatus === "approved"
                      ? "bg-accent-soft text-accent"
                      : bp.approvalStatus === "rejected"
                        ? "bg-rose-soft text-rose"
                        : "bg-slate-soft text-slate"
                  )}
                >
                  {bp.approvalStatus}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-[0.8125rem]">
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
          ))}
        </div>
      )}

      {showForm && (
        <NewBillingProfileModal
          token={token}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ["billingProfiles"] });
          }}
        />
      )}
    </div>
  );
}

function NewBillingProfileModal({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: () => void }) {
  const [pan, setPan] = useState("");
  const [name, setName] = useState("");
  const [gstin, setGstin] = useState("");
  const [msme, setMsme] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");

  const createMutation = useMutation({
    mutationFn: () => billingApi.create(token, { pan: pan.toUpperCase(), name, gstin: gstin || undefined, msme: msme || undefined, bankAccountNumber, ifscCode: ifscCode.toUpperCase() }),
    onSuccess: onCreated,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="flex w-full max-w-[460px] flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-card"
      >
        <h2 className="text-lg font-bold">Add a billing profile</h2>

        <div className="grid grid-cols-2 gap-4">
          <Field label="PAN">
            <TextField required value={pan} onChange={(v) => setPan(v.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
          </Field>
          <Field label="Name on PAN">
            <TextField required value={name} onChange={setName} />
          </Field>
          <Field label="GSTIN (optional)">
            <TextField value={gstin} onChange={setGstin} />
          </Field>
          <Field label="MSME number (optional)">
            <TextField value={msme} onChange={setMsme} />
          </Field>
          <Field label="Bank account number">
            <TextField required value={bankAccountNumber} onChange={setBankAccountNumber} />
          </Field>
          <Field label="IFSC code">
            <TextField required value={ifscCode} onChange={(v) => setIfscCode(v.toUpperCase())} />
          </Field>
        </div>

        {createMutation.isError && (
          <ErrorNotice message={createMutation.error instanceof ApiError ? createMutation.error.message : "Couldn't add this billing profile."} />
        )}

        <div className="flex gap-2.5">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Adding…" : "Add profile"}
          </Button>
        </div>
      </form>
    </div>
  );
}
