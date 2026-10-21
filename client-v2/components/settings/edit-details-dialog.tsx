"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ME_CHANGED_EVENT, useAuth } from "@/lib/auth-context";
import { admin as adminApi, ApiError, type User, type UserDetailField } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/taggify/field";

const LABEL: Record<UserDetailField, string> = {
  name: "Name",
  phoneNumber: "Phone",
  secondaryPhone: "WhatsApp number",
  addressLine1: "Address line 1",
  addressLine2: "Address line 2",
  state: "State",
  pincode: "PIN code",
};
const FIELDS = Object.keys(LABEL) as UserDetailField[];
const PHONES: UserDetailField[] = ["phoneNumber", "secondaryPhone"];

/** "+919876543210" → "9876543210": the boxes hold the 10 local digits. */
const localDigits = (phone?: string | null) => (phone ?? "").replace(/^\+91/, "").replace(/\D/g, "").slice(0, 10);
/** What the server stores: phones as +91…, other text trimmed; "" clears. */
const stored = (field: UserDetailField, v: string) => (PHONES.includes(field) ? (v ? `+91${v}` : "") : v.trim());

/**
 * People → Edit details (full admins; PUT /admin/users/:id/details): another
 * account's contact details and address, ported from v1's EditDetailsModal.
 * v1's four steps fit one dialog here; bank details live in their own section
 * of the person sheet, since each profile is saved and approved on its own.
 * Only changed fields are sent; the sign-in email stays on Change email.
 */
export function EditDetailsDialog({ person, onClose }: { person: User | null; onClose: () => void }) {
  return (
    <Dialog open={!!person} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-2xl">{person && <DetailsForm key={person.id} person={person} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function DetailsForm({ person, onClose }: { person: User; onClose: () => void }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const initial: Record<UserDetailField, string> = {
    name: person.name ?? "",
    phoneNumber: localDigits(person.phoneNumber),
    secondaryPhone: localDigits(person.secondaryPhone),
    addressLine1: person.addressLine1 ?? "",
    addressLine2: person.addressLine2 ?? "",
    state: person.state ?? "",
    pincode: person.pincode ?? "",
  };
  const [values, setValues] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const set = (field: UserDetailField, v: string) => {
    setValues((p) => ({ ...p, [field]: v }));
    setConfirming(false);
  };
  const changes = FIELDS.filter((f) => stored(f, values[f]) !== stored(f, initial[f])).map((f) => ({ field: f, before: stored(f, initial[f]), after: stored(f, values[f]) }));

  const errors: Partial<Record<UserDetailField, string | null>> = {
    // A name can be changed but not removed (an account with no name yet can stay that way).
    name: !values.name.trim() && initial.name ? "A name can't be removed. Enter a new one, or undo." : null,
    phoneNumber: values.phoneNumber && values.phoneNumber.length !== 10 ? "Enter a 10-digit mobile number." : null,
    secondaryPhone: values.secondaryPhone && values.secondaryPhone.length !== 10 ? "Enter a 10-digit mobile number." : null,
    pincode: values.pincode && !/^\d{6}$/.test(values.pincode) ? "Enter a 6-digit PIN code." : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const save = useMutation({
    mutationFn: () => adminApi.updateUserDetails(accessToken!, person.id, Object.fromEntries(changes.map((c) => [c.field, c.after]))),
    onSuccess: () => {
      toast.success(`Details saved for ${person.name?.trim() || person.email || "this person"}.`);
      qc.invalidateQueries({ queryKey: ["adminUsers"] });
      // An admin editing their own row also refreshes their own profile and the name in the top bar.
      qc.invalidateQueries({ queryKey: ["me"] });
      if (person.id === user?.id) window.dispatchEvent(new Event(ME_CHANGED_EVENT));
      onClose();
    },
  });

  const box = (field: UserDetailField, extra?: { phone?: boolean; digits?: number; max?: number; className?: string; description?: string }) => (
    <Field label={LABEL[field]} error={errors[field]} description={extra?.description} className={extra?.className}>
      {(a) => (
        <Input
          {...a}
          type={extra?.phone ? "tel" : "text"}
          inputMode={extra?.phone || extra?.digits ? "numeric" : undefined}
          autoComplete="off"
          maxLength={extra?.max}
          value={values[field]}
          onChange={(e) => set(field, extra?.phone ? e.target.value.replace(/\D/g, "").slice(0, 10) : extra?.digits ? e.target.value.replace(/\D/g, "").slice(0, extra.digits) : e.target.value)}
        />
      )}
    </Field>
  );

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!changes.length || invalid) return;
        // Second press saves: the first shows exactly what will change.
        if (!confirming) setConfirming(true);
        else save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit details</DialogTitle>
        <DialogDescription>Contact details and address. Their sign-in email is changed with Change email.</DialogDescription>
      </DialogHeader>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-body-strong">Contact</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {box("name", { max: 100, className: "sm:col-span-2" })}
          {box("phoneNumber", { phone: true, description: "10 digits; we add +91." })}
          {box("secondaryPhone", { phone: true, description: "For invoice alerts." })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-body-strong">Address</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {box("addressLine1", { max: 200, className: "sm:col-span-2" })}
          {box("addressLine2", { max: 200, className: "sm:col-span-2" })}
          {box("state", { max: 60 })}
          {box("pincode", { digits: 6 })}
        </div>
      </fieldset>

      {confirming && changes.length > 0 && (
        <div className="flex flex-col gap-2" role="status">
          <p className="text-body-strong">Save these changes?</p>
          <dl className="divide-y rounded-card border">
            {changes.map((c) => (
              <div key={c.field} className="grid gap-1 px-4 py-2.5 text-small sm:grid-cols-3 sm:gap-3">
                <dt className="text-muted-foreground">{LABEL[c.field]}</dt>
                <dd className="min-w-0 break-words sm:col-span-2">
                  <span className="text-muted-foreground line-through">{c.before || "Empty"}</span>
                  <span className="sr-only"> changes to </span>
                  <span aria-hidden className="mx-1.5 text-muted-foreground">
                    →
                  </span>
                  <span className="font-semibold text-foreground">{c.after || "Cleared"}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {save.isError && (
        <p role="alert" className="text-small text-danger-helper">
          {save.error instanceof ApiError ? save.error.message : "Couldn't save these details."}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={confirming ? () => setConfirming(false) : onClose}>
          {confirming ? "Back to editing" : "Cancel"}
        </Button>
        <Button type="submit" disabled={!changes.length || invalid || save.isPending}>
          {save.isPending ? "Saving…" : confirming ? `Save ${changes.length} ${changes.length === 1 ? "change" : "changes"}` : "Review changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
