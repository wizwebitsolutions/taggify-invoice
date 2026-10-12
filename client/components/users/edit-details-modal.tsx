"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Steps } from "@/components/ui/steps";
import { Field, TextField, PhoneField, VALIDATORS, digitsOnly, FieldError } from "@/components/ui/form-field";
import { TableSkeleton, ErrorNotice } from "@/components/ui/table-parts";
import { BillingProfileForm, type BillingProfileValues } from "@/components/billing/billing-profile-form";
import { admin as adminApi, billing as billingApi, ApiError, type BillingProfile, type User, type UserDetailField } from "@/lib/api-client";
import { personLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const STEPS = ["Contact", "Address", "Billing", "Review"];

const LABEL: Record<UserDetailField, string> = {
  name: "Name",
  phoneNumber: "Phone",
  secondaryPhone: "Secondary phone",
  addressLine1: "Address line 1",
  addressLine2: "Address line 2",
  state: "State",
  pincode: "Pincode",
};

/** "+919876543210" → "9876543210" — PhoneField holds the 10 local digits. */
const localDigits = (phone: string | null | undefined) => (phone ?? "").replace(/^\+91/, "").replace(/\D/g, "").slice(0, 10);

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * People → Edit details (12 Oct): a full admin edits another account's
 * contact details, address and billing profiles, one step at a time —
 * Contact → Address → Billing → Review. Contact + address are saved together
 * from Review (only the changed fields are sent); billing profiles save
 * individually on their own step, since each is its own approved record.
 * The login email is not here — that's the separate Change email action.
 */
export function EditDetailsModal({ token, targetUser, onClose, onSaved }: { token: string; targetUser: User; onClose: () => void; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  // A billing profile form open on step 3 — moving steps would drop its unsaved edits.
  const [billingOpen, setBillingOpen] = useState(false);

  const initial: Record<UserDetailField, string> = {
    name: targetUser.name ?? "",
    phoneNumber: localDigits(targetUser.phoneNumber),
    secondaryPhone: localDigits(targetUser.secondaryPhone),
    addressLine1: targetUser.addressLine1 ?? "",
    addressLine2: targetUser.addressLine2 ?? "",
    state: targetUser.state ?? "",
    pincode: targetUser.pincode ?? "",
  };
  const [values, setValues] = useState(initial);
  const set = (field: UserDetailField) => (v: string) => setValues((prev) => ({ ...prev, [field]: v }));

  // What the server stores — phones back to +91 form; trimmed text.
  const stored = (field: UserDetailField, v: string) => {
    if (field === "phoneNumber" || field === "secondaryPhone") return v ? `+91${v}` : "";
    return v.trim();
  };
  const changes = (Object.keys(LABEL) as UserDetailField[])
    .filter((f) => stored(f, values[f]) !== stored(f, initial[f]))
    .map((f) => ({ field: f, before: stored(f, initial[f]), after: stored(f, values[f]) }));

  const contactErrors = {
    // A name can be changed but not removed (an account with no name yet can stay that way).
    name: !values.name.trim() && initial.name ? "Name can't be empty." : null,
    phoneNumber: values.phoneNumber && values.phoneNumber.length !== 10 ? "Enter a valid 10-digit mobile number." : null,
    secondaryPhone: values.secondaryPhone && values.secondaryPhone.length !== 10 ? "Enter a valid 10-digit mobile number." : null,
  };
  const addressErrors = { pincode: VALIDATORS.pincode(values.pincode) };
  const stepInvalid = step === 0 ? Object.values(contactErrors).some(Boolean) : step === 1 ? Object.values(addressErrors).some(Boolean) : false;

  const saveMutation = useMutation({
    mutationFn: () => adminApi.updateUserDetails(token, targetUser.id, Object.fromEntries(changes.map((c) => [c.field, c.after]))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminUsers"] });
      // An admin editing their own row also refreshes their own profile.
      queryClient.invalidateQueries({ queryKey: ["me"] });
      onSaved();
    },
  });

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[640px]">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6 pt-1" data-testid="edit-details">
        <div>
          <h2 className="text-lg font-semibold">Edit details</h2>
          <p className="mt-1 text-[0.8125rem] text-text-muted">
            <strong className="text-text">{personLabel(targetUser)}</strong>&apos;s contact details, address and billing profiles. Their sign-in email is changed separately.
          </p>
        </div>
        <Steps steps={STEPS} current={step} />

        {step === 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name">
              <TextField value={values.name} onChange={set("name")} aria-label="Name" />
              <FieldError message={contactErrors.name} />
            </Field>
            <Field label="Phone">
              <PhoneField value={values.phoneNumber} onChange={set("phoneNumber")} aria-label="Phone" placeholder="Optional" />
            </Field>
            <Field label="Secondary phone">
              <PhoneField value={values.secondaryPhone} onChange={set("secondaryPhone")} aria-label="Secondary phone" placeholder="WhatsApp / alternate" />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Address line 1">
              <TextField value={values.addressLine1} onChange={set("addressLine1")} aria-label="Address line 1" maxLength={200} />
            </Field>
            <Field label="Address line 2">
              <TextField value={values.addressLine2} onChange={set("addressLine2")} aria-label="Address line 2" maxLength={200} />
            </Field>
            <Field label="State">
              <TextField value={values.state} onChange={set("state")} aria-label="State" maxLength={60} />
            </Field>
            <Field label="Pincode">
              <TextField inputMode="numeric" maxLength={6} value={values.pincode} onChange={(v) => set("pincode")(digitsOnly(v, 6))} aria-label="Pincode" />
              <FieldError message={addressErrors.pincode} />
            </Field>
          </div>
        )}

        {step === 2 && <BillingStep token={token} targetUser={targetUser} onEditingChange={setBillingOpen} />}
        {step === 2 && billingOpen && <p className="text-[0.75rem] text-accent-2">Save or cancel the billing profile you&apos;re editing before moving on.</p>}

        {step === 3 && (
          <div className="flex flex-col gap-3" data-testid="edit-details-review">
            {changes.length === 0 ? (
              <p className="rounded-md border border-border bg-surface-2 px-3.5 py-3 text-[0.8125rem] text-text-muted">No contact or address changes to save. Billing profile edits are already saved.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                {changes.map((c) => (
                  <div key={c.field} className="grid grid-cols-[8rem_1fr] gap-3 border-b border-border px-3.5 py-2.5 text-[0.8125rem] last:border-b-0">
                    <span className="text-text-muted">{LABEL[c.field]}</span>
                    <span className="min-w-0 break-words">
                      <span className="text-text-faint line-through">{c.before || "—"}</span>
                      <span className="mx-1.5 text-text-faint">→</span>
                      <span className="font-medium text-text">{c.after || "(cleared)"}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {saveMutation.isError && <ErrorNotice message={errorText(saveMutation.error, "Couldn't save these details.")} />}
          </div>
        )}

        <div className="mt-auto flex gap-2.5 border-t border-border pt-4">
          <Button type="button" variant="ghost" className="flex-1" disabled={billingOpen} onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" className="flex-1" disabled={stepInvalid || billingOpen} onClick={() => setStep(step + 1)}>
              Next
            </Button>
          ) : (
            <Button type="button" className="flex-1" disabled={saveMutation.isPending} onClick={() => (changes.length ? saveMutation.mutate() : onClose())}>
              {saveMutation.isPending ? "Saving…" : changes.length ? "Save details" : "Done"}
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

const maskAccount = (n: string) => (n.length > 4 ? `•••• ${n.slice(-4)}` : n);
const APPROVAL_TONE: Record<BillingProfile["approvalStatus"], string> = {
  approved: "bg-accent-soft text-accent",
  pending: "bg-accent-2-soft text-accent-2",
  rejected: "bg-rose-soft text-rose",
};

/** Step 3: the account's billing profiles — edit one in place, or add one. Each save is immediate. */
function BillingStep({ token, targetUser, onEditingChange }: { token: string; targetUser: User; onEditingChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditingState] = useState<string | "new" | null>(null);
  const setEditing = (v: string | "new" | null) => {
    setEditingState(v);
    onEditingChange(v !== null);
  };
  const [savedId, setSavedId] = useState<string | null>(null);

  // GET /billing-profiles returns every profile for a finance.view holder (a full admin is one).
  const profilesQuery = useQuery({ queryKey: ["billingProfiles"], queryFn: () => billingApi.list(token) });
  const profiles = (profilesQuery.data ?? []).filter((p) => p.userId === targetUser.id);

  const saveMutation = useMutation({
    mutationFn: ({ id, v }: { id: string | "new"; v: BillingProfileValues }) =>
      id === "new"
        ? adminApi.createBillingProfileFor(token, targetUser.id, { pan: v.pan, name: v.name, gstin: v.gstin || undefined, msme: v.msme || undefined, bankAccountNumber: v.bankAccountNumber, ifscCode: v.ifscCode })
        : billingApi.update(token, id, { pan: v.pan, name: v.name, gstin: v.gstin || null, msme: v.msme || null, bankAccountNumber: v.bankAccountNumber, ifscCode: v.ifscCode }),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["billingProfiles"] });
      setSavedId(saved.id);
      setEditing(null);
    },
  });

  if (profilesQuery.isLoading) return <TableSkeleton rows={2} />;

  const form = (profile?: BillingProfile) => (
    <div className="rounded-md border border-border-strong bg-surface p-4">
      <BillingProfileForm
        key={profile?.id ?? "new"}
        profile={profile}
        onSubmit={(v) => saveMutation.mutate({ id: profile?.id ?? "new", v })}
        onCancel={() => {
          setEditing(null);
          saveMutation.reset();
        }}
        submitting={saveMutation.isPending}
        error={saveMutation.isError ? errorText(saveMutation.error, "Couldn't save this billing profile.") : null}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="edit-details-billing">
      {profiles.length === 0 && editing !== "new" && <p className="text-[0.8125rem] text-text-muted">No billing profiles on this account yet.</p>}
      {profiles.map((p) =>
        editing === p.id ? (
          <div key={p.id}>{form(p)}</div>
        ) : (
          <div key={p.id} className="flex items-start justify-between gap-3 rounded-md border border-border px-3.5 py-3" data-testid="edit-details-billing-card">
            <div className="min-w-0 text-[0.8125rem]">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {p.pan} <span className="font-normal text-text-muted">· {p.name}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[0.7rem] font-medium capitalize", APPROVAL_TONE[p.approvalStatus])}>{p.approvalStatus}</span>
              </p>
              <p className="mt-0.5 text-text-muted">
                A/c {maskAccount(p.bankAccountNumber)} · {p.ifscCode}
                {p.gstin ? ` · GSTIN ${p.gstin}` : ""}
              </p>
              {savedId === p.id && <p className="mt-1 text-[0.75rem] font-semibold text-accent">Saved.</p>}
            </div>
            <Button size="sm" variant="secondary" onClick={() => setEditing(p.id)} disabled={editing !== null} aria-label={`Edit billing profile ${p.pan}`}>
              Edit
            </Button>
          </div>
        )
      )}
      {editing === "new" ? (
        form()
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setEditing("new")} disabled={editing !== null}>
          Add billing profile
        </Button>
      )}
      <p className="text-[0.72rem] text-text-faint">A new profile starts pending and goes through Finance approval as usual.</p>
    </div>
  );
}
