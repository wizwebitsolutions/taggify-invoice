"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-context";
import { ApiError, assets as assetsApi, type AssetOwner, type VendorEdit } from "@/lib/api-client";
import { canApprovePages, canEditVendors, canSuggestVendorEdits } from "@/lib/creators";
import { personLabel } from "@/lib/format";
import { invalidatePages } from "@/lib/queries/creators";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/taggify/field";

type FieldKey = keyof Required<VendorEdit>;
const LABEL: Record<FieldKey, string> = { name: "Name", phoneNumber: "Phone", secondaryPhone: "WhatsApp number" };
const FIELDS = Object.keys(LABEL) as FieldKey[];
const PHONES: FieldKey[] = ["phoneNumber", "secondaryPhone"];

/** "+919876543210" → "9876543210": the boxes hold the 10 local digits. */
const localDigits = (phone?: string | null) => (phone ?? "").replace(/^\+91/, "").replace(/\D/g, "").slice(0, 10);
/** What the server stores: phones as +91…, null when cleared; the name trimmed. */
const stored = (field: FieldKey, v: string): string | null => (PHONES.includes(field) ? (v ? `+91${v}` : null) : v.trim());
const shown = (v: string | null | undefined) => v || "Empty";
const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/** Can this user open the vendor form at all (edit directly or suggest)? */
export const canChangeVendor = (u: Parameters<typeof canEditVendors>[0]) => canEditVendors(u) || canSuggestVendorEdits(u);

/**
 * Edit a vendor's contact details from Inventory (13 Nov). An admin's save
 * applies at once; a plan maker's goes to an admin as a suggestion. Email
 * (their sign-in) and bank details stay in Settings → People.
 */
export function VendorEditDialog({ vendor, onClose }: { vendor: AssetOwner | null; onClose: () => void }) {
  return (
    <Dialog open={!!vendor} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">{vendor && <VendorForm key={vendor.id} vendor={vendor} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

/* ── Shared by the dialog and the page sheet's Edit details form ── */

export type VendorValues = Record<FieldKey, string>;
/** The form's starting values: the name, and the phones as 10 local digits. */
export const vendorInitial = (v: AssetOwner): VendorValues => ({ name: v.name ?? "", phoneNumber: localDigits(v.phoneNumber), secondaryPhone: localDigits(v.secondaryPhone) });
/** Only the fields that changed, in the shape the server stores (null clears a phone). */
export function vendorChanges(initial: VendorValues, values: VendorValues): VendorEdit {
  return Object.fromEntries(FIELDS.filter((f) => stored(f, values[f]) !== stored(f, initial[f])).map((f) => [f, stored(f, values[f])])) as VendorEdit;
}
export function vendorErrors(initial: VendorValues, values: VendorValues): Record<FieldKey, string | null> {
  return {
    name: !values.name.trim() && initial.name ? "A name can't be removed. Enter a new one, or undo." : null,
    phoneNumber: values.phoneNumber && values.phoneNumber.length !== 10 ? "Enter a 10-digit mobile number." : null,
    secondaryPhone: values.secondaryPhone && values.secondaryPhone.length !== 10 ? "Enter a 10-digit mobile number." : null,
  };
}
/** Saves a vendor change the way this user may: directly (admin) or as a suggestion (plan maker). */
export const saveVendorChange = (direct: boolean, token: string, vendorId: string, body: VendorEdit) => (direct ? assetsApi.editVendor(token, vendorId, body) : assetsApi.proposeVendorEdit(token, vendorId, body));

/** Name, phone and WhatsApp boxes (Field gives each its own id). */
export function VendorFields({ values, errors, onChange }: { values: VendorValues; errors: Record<FieldKey, string | null>; onChange: (v: VendorValues) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {FIELDS.map((f) => (
        <Field key={f} label={LABEL[f]} error={errors[f]} description={PHONES.includes(f) ? "10 digits; we add +91." : undefined} className={f === "name" ? "sm:col-span-2" : undefined}>
          {(a) => (
            <Input
              {...a}
              type={PHONES.includes(f) ? "tel" : "text"}
              inputMode={PHONES.includes(f) ? "numeric" : undefined}
              autoComplete="off"
              maxLength={f === "name" ? 100 : undefined}
              value={values[f]}
              onChange={(e) => onChange({ ...values, [f]: PHONES.includes(f) ? e.target.value.replace(/\D/g, "").slice(0, 10) : e.target.value })}
            />
          )}
        </Field>
      ))}
    </div>
  );
}

function VendorForm({ vendor, onClose }: { vendor: AssetOwner; onClose: () => void }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const direct = canEditVendors(user);
  const initial = vendorInitial(vendor);
  const [values, setValues] = useState(initial);
  const body = vendorChanges(initial, values);
  const changes = Object.keys(body);
  const errors = vendorErrors(initial, values);
  const invalid = Object.values(errors).some(Boolean);
  const label = personLabel(vendor, "this vendor");

  const save = useMutation({
    mutationFn: () => saveVendorChange(direct, accessToken!, vendor.id, body),
    onSuccess: async () => {
      // Vendors are read off the pages list, and People shows the same account.
      await invalidatePages(qc);
      qc.invalidateQueries({ queryKey: ["adminUsers"] });
      toast.success(direct ? `Saved ${label}'s details.` : "Suggestion sent. An admin will apply it.");
      onClose();
    },
  });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (changes.length && !invalid) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{direct ? "Edit vendor" : "Suggest a vendor change"}</DialogTitle>
        <DialogDescription>
          {direct ? `Contact details for ${label}. Email and bank details are changed in Settings → People.` : `Your change goes to an admin for approval. ${label}'s details stay as they are until then.`}
        </DialogDescription>
      </DialogHeader>

      {vendor.pendingVendorEdit && (
        <p className="rounded-md bg-muted px-3 py-2 text-small text-muted-foreground">
          {direct ? "A suggested change is waiting for this vendor. Saving here doesn't apply or discard it." : "A suggested change is already waiting. Sending this replaces it."}
        </p>
      )}

      <VendorFields values={values} errors={errors} onChange={setValues} />

      {save.isError && (
        <p role="alert" className="text-small text-danger-helper">
          {errText(save.error, "Couldn't save. Try again.")}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!changes.length || invalid || save.isPending}>
          {save.isPending ? (direct ? "Saving…" : "Sending…") : direct ? "Save" : "Send for approval"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The fields a waiting suggestion changes, as [label, now, suggested]. */
export function vendorEditRows(owner: AssetOwner): [string, string, string][] {
  const pending = owner.pendingVendorEdit ?? {};
  return FIELDS.filter((f) => f in pending).map((f) => [LABEL[f], shown(owner[f]), shown(pending[f])]);
}

/** A plan maker's waiting vendor change, now → suggested; Apply / Discard for whoever can approve Inventory. */
export function PendingVendorEditCard({ owner }: { owner: AssetOwner }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const canDecide = canApprovePages(user);
  const decide = useMutation({
    mutationFn: (d: "approve" | "reject") => assetsApi.decideVendorEdit(accessToken!, owner.id, d),
    onSuccess: async (_r, d) => {
      await invalidatePages(qc);
      qc.invalidateQueries({ queryKey: ["adminUsers"] });
      toast.success(d === "approve" ? "Vendor change applied." : "Vendor change discarded.");
    },
    onError: (e) => toast.error(errText(e, "That didn't go through. Try again.")),
  });
  if (!owner.pendingVendorEdit || Object.keys(owner.pendingVendorEdit).length === 0) return null;
  const by = owner.pendingVendorEditBy?.name ?? owner.pendingVendorEditBy?.email ?? "a planner";
  const when = owner.pendingVendorEditAt ? new Date(owner.pendingVendorEditAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : null;
  return (
    <section aria-labelledby={`vendor-edit-${owner.id}`} className="flex flex-col gap-3 rounded-card border border-brand-200 bg-brand-50 p-4" data-testid="pending-vendor-edit-card">
      <div>
        <h3 id={`vendor-edit-${owner.id}`} className="text-body-strong">
          Vendor change suggested by {by}
          {when ? <span className="font-normal text-muted-foreground"> · {when}</span> : null}
        </h3>
        <p className="text-small text-muted-foreground">{canDecide ? "Apply changes the vendor's details. Discard leaves them as they are." : "Waiting for an admin to apply or discard."}</p>
      </div>
      <dl className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5 text-small">
        {vendorEditRows(owner).map(([label, from, to]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right text-fg-muted line-through">{from}</dd>
            <dd className="text-right font-semibold">{to}</dd>
          </div>
        ))}
      </dl>
      {canDecide && (
        <div className="flex gap-2">
          <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate("approve")}>
            Apply
          </Button>
          <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate("reject")}>
            Discard
          </Button>
        </div>
      )}
    </section>
  );
}
