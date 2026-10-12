"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextField, FieldError, VALIDATORS, digitsOnly } from "@/components/ui/form-field";
import { ErrorNotice } from "@/components/ui/table-parts";
import type { BillingProfile } from "@/lib/api-client";

export interface BillingProfileValues {
  pan: string;
  name: string;
  gstin: string;
  msme: string;
  bankAccountNumber: string;
  ifscCode: string;
}

/**
 * The billing profile fields (PAN, name on PAN, GSTIN, MSME, bank account,
 * IFSC) with their inline format checks — shared by Profile → Billing's
 * modal and People → Edit details (12 Oct) so the two can't drift. The
 * caller owns the mutation; this only collects and validates.
 */
export function BillingProfileForm({
  profile,
  onSubmit,
  onCancel,
  submitting,
  error,
  submitLabel,
}: {
  profile?: BillingProfile;
  onSubmit: (values: BillingProfileValues) => void;
  onCancel: () => void;
  submitting: boolean;
  error?: string | null;
  submitLabel?: string;
}) {
  const [pan, setPan] = useState(profile?.pan ?? "");
  const [name, setName] = useState(profile?.name ?? "");
  const [gstin, setGstin] = useState(profile?.gstin ?? "");
  const [msme, setMsme] = useState(profile?.msme ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(profile?.bankAccountNumber ?? "");
  const [ifscCode, setIfscCode] = useState(profile?.ifscCode ?? "");

  const invalid = Boolean(VALIDATORS.pan(pan) || VALIDATORS.gstin(gstin) || VALIDATORS.ifsc(ifscCode) || VALIDATORS.bankAccount(bankAccountNumber)) || !name.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ pan: pan.toUpperCase(), name, gstin, msme, bankAccountNumber, ifscCode: ifscCode.toUpperCase() });
      }}
      className="flex flex-col gap-5"
      data-testid="billing-profile-form"
    >
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

      {error && <ErrorNotice message={error} />}

      <div className="flex gap-2.5">
        <Button type="button" variant="ghost" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" disabled={submitting || invalid}>
          {submitting ? (profile ? "Saving…" : "Adding…") : (submitLabel ?? (profile ? "Save changes" : "Add profile"))}
        </Button>
      </div>
    </form>
  );
}
