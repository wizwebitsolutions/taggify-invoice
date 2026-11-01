"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Circle, Pencil, Plus } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { admin as adminApi, ApiError, auth as authApi, billing as billingApi, hasAccess, users as usersApi, type BillingProfile, type User } from "@/lib/api-client";
import { BILLING_RULES, canAddOwnBilling, canSeeOwnBilling, PASSWORD_RULES, ROLE_NAMES } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/taggify/field";
import { StatusPill } from "@/components/taggify/status-pill";
import { UserAvatar } from "@/components/taggify/user-avatar";
import { LoadError } from "@/components/finance/states";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const tenDigits = (v?: string | null) => (v ?? "").replace(/^\+91/, "").replace(/\D/g, "").slice(0, 10);

/** My profile: contact details (PUT /users/me), password (POST /auth/change-password) and own bank details (/billing-profiles). */
export function ProfileTab({ bare = false }: { bare?: boolean }) {
  const { user, accessToken } = useAuth();
  const me = useQuery({ queryKey: ["me"], queryFn: () => usersApi.me(accessToken!), enabled: !!accessToken });

  return (
    // bare: the only tab (creators, planners), so no outer card around these cards.
    <div className={cn("grid items-start gap-5 xl:grid-cols-2", !bare && "border-t p-5")}>
      {me.isError ? (
        <LoadError onRetry={() => me.refetch()} what="your profile" />
      ) : !me.data ? (
        <Skeleton className="h-96" aria-label="Loading your profile" />
      ) : (
        <ContactCard key={me.data.id} me={me.data} />
      )}
      <div className="flex flex-col gap-5">
        <PasswordCard />
        {canSeeOwnBilling(user) && <BankCard />}
      </div>
    </div>
  );
}

function Card({ title, description, children, id }: { title: string; description?: string; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="settings-section">
      <div className="form-section-heading">
        <h2 id={id} className="text-card-title">
          {title}
        </h2>
        {description && <p className="mt-1 text-small text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function ContactCard({ me }: { me: User }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const start = { name: me.name ?? "", email: me.email ?? "", secondaryPhone: tenDigits(me.secondaryPhone), addressLine1: me.addressLine1 ?? "", addressLine2: me.addressLine2 ?? "", state: me.state ?? "", pincode: me.pincode ?? "" };
  const [f, setF] = useState(start);
  const set = (k: keyof typeof start) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const emailLocked = !!me.emailVerifiedAt;

  const errors = {
    name: f.name.trim() ? null : start.name ? "Your name can't be empty." : null,
    email: emailLocked ? null : !f.email.trim() ? (start.email ? "Your email can't be empty." : null) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) ? null : "Enter an email like name@gmail.com.",
    // The server needs a full number and can't clear one once saved.
    secondaryPhone: f.secondaryPhone && f.secondaryPhone.length !== 10 ? "Enter a 10-digit mobile number." : !f.secondaryPhone && start.secondaryPhone ? "This can't be removed here. Enter a new number, or undo." : null,
    // Checked only when changed: an older saved value mustn't block saving other fields.
    pincode: !f.pincode || f.pincode === start.pincode || /^[1-9]\d{5}$/.test(f.pincode) ? null : "Enter a 6-digit PIN code.",
  };
  const changed = (Object.keys(start) as (keyof typeof start)[]).filter((k) => f[k].trim() !== start[k]);
  const invalid = Object.values(errors).some(Boolean);

  const save = useMutation({
    mutationFn: () =>
      usersApi.updateProfile(
        accessToken!,
        Object.fromEntries(
          changed
            .filter((k) => !(k === "email" && emailLocked))
            .map((k) => [k, k === "secondaryPhone" ? `+91${f[k]}` : f[k].trim()])
            // Optional fields can't be sent blank where the server checks a length.
            .filter(([k, v]) => v !== "" || !["name", "email"].includes(k))
        )
      ),
    onSuccess: (saved) => {
      qc.setQueryData(["me"], saved);
      toast.success("Profile saved.");
    },
    onError: (e) => toast.error(errText(e, "Couldn't save your profile.")),
  });

  return (
    <Card id="contact-title" title="Your details" description="How Taggify reaches you. Your sign-in email can't be changed here once it's verified; ask an admin.">
      <div className="settings-identity">
        <UserAvatar name={me.name ?? me.email} size="md" />
        <span className="min-w-0">
          <span className="block truncate text-body-strong">{me.name?.trim() || me.email}</span>
          <span className="block text-small text-muted-foreground">{ROLE_NAMES[me.role]}</span>
        </span>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed.length && !invalid) save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={errors.name}>
            {(a) => <Input {...a} value={f.name} onChange={set("name")} maxLength={100} autoComplete="name" />}
          </Field>
          <Field label="Sign-in email" error={errors.email} description={emailLocked ? "Verified. Used to sign in." : "Not verified yet. You'll confirm it with a code at sign-in."}>
            {(a) => <Input {...a} type="email" value={f.email} onChange={set("email")} disabled={emailLocked} autoComplete="email" />}
          </Field>
          <Field label="Registered mobile" description="Set when your account was made.">
            {(a) => <Input {...a} value={me.phoneNumber ?? "Not added"} disabled />}
          </Field>
          <Field label="WhatsApp number (optional)" error={errors.secondaryPhone} description="For invoice alerts. 10 digits; we add +91.">
            {(a) => <Input {...a} type="tel" inputMode="numeric" value={f.secondaryPhone} onChange={(e) => setF((p) => ({ ...p, secondaryPhone: e.target.value.replace(/\D/g, "").slice(0, 10) }))} />}
          </Field>
          <Field label="Address line 1" className="sm:col-span-2">
            {(a) => <Input {...a} value={f.addressLine1} onChange={set("addressLine1")} maxLength={200} autoComplete="address-line1" />}
          </Field>
          <Field label="Address line 2" className="sm:col-span-2">
            {(a) => <Input {...a} value={f.addressLine2} onChange={set("addressLine2")} maxLength={200} autoComplete="address-line2" />}
          </Field>
          <Field label="State">{(a) => <Input {...a} value={f.state} onChange={set("state")} maxLength={60} autoComplete="address-level1" />}</Field>
          <Field label="PIN code" error={errors.pincode}>
            {(a) => <Input {...a} inputMode="numeric" value={f.pincode} onChange={(e) => setF((p) => ({ ...p, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) }))} autoComplete="postal-code" />}
          </Field>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={!changed.length || invalid || save.isPending}>
            {save.isPending ? "Saving…" : "Save details"}
          </Button>
          {changed.length > 0 && (
            <Button type="button" variant="ghost" onClick={() => setF(start)}>
              Undo changes
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

/** A password change signs out every session, this one included (auth/service.js changePassword), so we sign out here too. */
function PasswordCard() {
  const { accessToken, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const ok = PASSWORD_RULES.every((r) => r.test(next));
  const change = useMutation({
    mutationFn: () => authApi.changePassword(accessToken!, current, next),
    onSuccess: () => {
      toast.success("Password changed. Sign in with your new password.");
      logout(); // RequireAuth then sends this page to /login

    },
  });

  return (
    <Card id="password-title" title="Password" description="Changing it signs you out everywhere, here too.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (current && ok) change.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Current password" error={change.isError ? errText(change.error, "Couldn't change your password.") : null}>
            {(a) => <Input {...a} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
          </Field>
          <Field label="New password">{(a) => <Input {...a} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
        </div>
        <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Password rules">
          {PASSWORD_RULES.map((r) => {
            const met = r.test(next);
            return (
              <li key={r.label} className={cn("flex items-center gap-2 text-small", met ? "text-success-fg" : "text-muted-foreground")}>
                {met ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : <Circle className="h-4 w-4 shrink-0" aria-hidden />}
                {r.label}
                <span className="sr-only">{met ? "(done)" : "(needed)"}</span>
              </li>
            );
          })}
        </ul>
        <Button type="submit" className="self-start" disabled={!current || !ok || change.isPending}>
          {change.isPending ? "Changing…" : "Change password"}
        </Button>
      </form>
    </Card>
  );
}

export const APPROVAL: Record<BillingProfile["approvalStatus"], { tone: "success" | "warning" | "danger"; label: string }> = {
  approved: { tone: "success", label: "Approved" },
  pending: { tone: "warning", label: "Waiting for approval" },
  rejected: { tone: "danger", label: "Rejected" },
};

/** Your own billing profiles: where your payouts go. Finance approves new or changed details before paying. */
function BankCard() {
  const { user, accessToken } = useAuth();
  // Same key as Payouts and Approvals: GET /billing-profiles answers per user (everyone's for finance.view, else your own).
  const list = useQuery({ queryKey: ["billing", "all"], queryFn: () => billingApi.list(accessToken!), enabled: !!accessToken });
  const mine = (list.data ?? []).filter((b) => b.userId === user?.id);
  const [editing, setEditing] = useState<BillingProfile | "new" | null>(null);
  const canAdd = canAddOwnBilling(user);

  return (
    <Card id="bank-title" title="Bank details" description="Where your payouts go. Finance checks new or changed details before paying them.">
      {list.isError ? (
        <LoadError onRetry={() => list.refetch()} what="your bank details" />
      ) : list.isLoading ? (
        <Skeleton className="h-24" />
      ) : mine.length === 0 ? (
        <p className="text-small text-muted-foreground">No bank details yet.{canAdd ? " Add them to get paid." : ""}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {mine.map((b) => (
            <li key={b.id} className="flex items-start gap-3 rounded-card border p-4" data-testid={`bank-${b.id}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-strong">{b.name}</p>
                <p className="text-small text-muted-foreground">
                  •••• {b.bankAccountNumber.slice(-4)} · {b.ifscCode} · PAN {b.pan}
                </p>
                {b.gstin && <p className="text-small text-muted-foreground">GSTIN {b.gstin}</p>}
                <StatusPill className="mt-2" tone={APPROVAL[b.approvalStatus].tone}>
                  {APPROVAL[b.approvalStatus].label}
                </StatusPill>
              </div>
              {canAdd && (
                <Button variant="outline" size="sm" onClick={() => setEditing(b)} aria-label={`Edit bank details ${b.name}`}>
                  <Pencil />
                  Edit
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <Button variant="outline" className="self-start" onClick={() => setEditing("new")}>
          <Plus />
          Add bank details
        </Button>
      )}
      {/* billing/service.js update: a finance.edit holder's edit keeps the approval; anyone else's goes back to pending. */}
      <BankDialog profile={editing} reviewer={hasAccess(user, "finance.edit")} onClose={() => setEditing(null)} />
    </Card>
  );
}

/**
 * Add or edit one billing profile. `owner` = someone else's account (People →
 * person sheet, full admins): a new one is created for them via
 * POST /admin/users/:id/billing-profiles; edits use the same PUT as your own.
 */
export function BankDialog({ profile, reviewer, onClose, owner }: { profile: BillingProfile | "new" | null; reviewer: boolean; onClose: () => void; owner?: { id: string; name: string } }) {
  return (
    <Dialog open={!!profile} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-screen overflow-y-auto">
        {profile && <BankForm key={profile === "new" ? "new" : profile.id} profile={profile === "new" ? null : profile} reviewer={reviewer} onClose={onClose} owner={owner} />}
      </DialogContent>
    </Dialog>
  );
}

function BankForm({ profile, reviewer, onClose, owner }: { profile: BillingProfile | null; reviewer: boolean; onClose: () => void; owner?: { id: string; name: string } }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const start = { pan: profile?.pan ?? "", name: profile?.name ?? "", gstin: profile?.gstin ?? "", msme: profile?.msme ?? "", account: profile?.bankAccountNumber ?? "", ifsc: profile?.ifscCode ?? "" };
  const [f, setF] = useState(start);
  const [touched, setTouched] = useState(false);
  const changed = (k: keyof typeof start) => !profile || f[k].trim() !== start[k];
  // A field is only checked when it's new or changed: an older saved value the server accepted mustn't block an edit.
  const errors = {
    pan: changed("pan") ? BILLING_RULES.pan(f.pan) : null,
    name: f.name.trim() ? null : "Enter the name on the PAN.",
    gstin: changed("gstin") ? BILLING_RULES.gstin(f.gstin) : null,
    account: changed("account") ? BILLING_RULES.account(f.account) : null,
    ifsc: changed("ifsc") ? BILLING_RULES.ifsc(f.ifsc) : null,
  };
  const invalid = Object.values(errors).some(Boolean);
  const dirty = (Object.keys(start) as (keyof typeof start)[]).some(changed);
  const show = (k: keyof typeof errors) => (touched ? errors[k] : null);

  const save = useMutation({
    mutationFn: () => {
      if (!profile) {
        const body = { pan: f.pan, name: f.name.trim(), bankAccountNumber: f.account, ifscCode: f.ifsc, gstin: f.gstin || undefined, msme: f.msme.trim() || undefined };
        return owner ? adminApi.createBillingProfileFor(accessToken!, owner.id, body) : billingApi.create(accessToken!, body);
      }
      // Only what changed: any owner edit sends the profile back for approval (billing/service.js update).
      const all = { pan: f.pan, name: f.name.trim(), bankAccountNumber: f.account, ifscCode: f.ifsc, gstin: f.gstin || null, msme: f.msme.trim() || null };
      const field = { pan: "pan", name: "name", account: "bankAccountNumber", ifsc: "ifscCode", gstin: "gstin", msme: "msme" } as const;
      return billingApi.update(accessToken!, profile.id, Object.fromEntries((Object.keys(field) as (keyof typeof field)[]).filter(changed).map((k) => [field[k], all[field[k]]])));
    },
    onSuccess: (saved) => {
      toast.success(saved.approvalStatus === "approved" ? "Bank details saved." : `Bank details saved. Finance will check them before ${owner ? "the" : "your"} next payout.`);
      onClose();
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["billing"] }),
  });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!invalid && dirty) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {profile ? "Edit bank details" : "Add bank details"}
          {owner && <span className="font-normal text-muted-foreground"> for {owner.name}</span>}
        </DialogTitle>
        <DialogDescription>
        {owner && !profile
          ? "New bank details start as waiting for approval and go through Finance as usual."
          : reviewer
          ? "You can approve bank details, so your changes keep their current approval."
          : profile?.approvalStatus === "approved"
            ? "Saving a change sends these details back to Finance to approve."
            : "Finance approves these before any payout goes to them."}
      </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="PAN" error={show("pan")}>
          {(a) => <Input {...a} value={f.pan} maxLength={10} autoComplete="off" placeholder="ABCDE1234F" onChange={(e) => setF((p) => ({ ...p, pan: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }))} />}
        </Field>
        <Field label="Name on PAN" error={show("name")}>
          {(a) => <Input {...a} value={f.name} maxLength={150} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />}
        </Field>
        <Field label="Account number" error={show("account")}>
          {(a) => <Input {...a} inputMode="numeric" value={f.account} autoComplete="off" onChange={(e) => setF((p) => ({ ...p, account: e.target.value.replace(/\D/g, "").slice(0, 18) }))} />}
        </Field>
        <Field label="IFSC" error={show("ifsc")}>
          {(a) => <Input {...a} value={f.ifsc} maxLength={11} autoComplete="off" placeholder="HDFC0001234" onChange={(e) => setF((p) => ({ ...p, ifsc: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11) }))} />}
        </Field>
        <Field label="GSTIN (optional)" error={show("gstin")}>
          {(a) => <Input {...a} value={f.gstin} maxLength={15} autoComplete="off" placeholder="27ABCDE1234F1Z5" onChange={(e) => setF((p) => ({ ...p, gstin: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15) }))} />}
        </Field>
        <Field label="MSME number (optional)">{(a) => <Input {...a} value={f.msme} maxLength={30} onChange={(e) => setF((p) => ({ ...p, msme: e.target.value }))} />}</Field>
      </div>
      {save.isError && (
        <p role="alert" className="text-small text-danger-helper">
          {errText(save.error, "Couldn't save the bank details.")}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending || !dirty || (touched && invalid)}>
          {save.isPending ? "Saving…" : profile ? "Save changes" : "Add bank details"}
        </Button>
      </DialogFooter>
    </form>
  );
}
