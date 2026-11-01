"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, KeyRound, Mail, Pencil, Plus, UserCheck, UserX } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { admin as adminApi, ApiError, billing as billingApi, hasAccess, isOwnScopeRole, PERMISSION_KEYS, type BillingProfile, type Permissions, type Role, type User } from "@/lib/api-client";
import { accessOf, canEditAccessOf, canEditPeople, canTakeOver, isFullAdmin, payloadFor, rolesForChange, ROLE_NAMES } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field } from "@/components/taggify/field";
import { StatusPill } from "@/components/taggify/status-pill";
import { UserAvatar } from "@/components/taggify/user-avatar";
import { AccessEditor } from "@/components/settings/access-editor";
import { EditDetailsDialog } from "@/components/settings/edit-details-dialog";
import { APPROVAL, BankDialog } from "@/components/settings/profile-tab";
import { LoadError } from "@/components/finance/states";
import { Skeleton } from "@/components/ui/skeleton";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const nameOf = (u: User) => u.name?.trim() || u.email || u.phoneNumber || "this person";

/** One person: role, access and sign-in. Every control mirrors a server guard in admin/service.js. */
export function PersonSheet({ person, onClose }: { person: User | null; onClose: () => void }) {
  return (
    <Sheet open={!!person} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl md:max-w-xl">
        {/* Keyed by role too: a role change drops the old access, so the editor starts again from the new role. */}
        {person && <PersonDetails key={`${person.id}:${person.role}`} person={person} />}
      </SheetContent>
    </Sheet>
  );
}

function PersonDetails({ person }: { person: User }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const me = user?.id === person.id;
  const editable = canEditAccessOf(user, person);
  // What the server last stored: updated from the save response, not the list refetch.
  const [current, setCurrent] = useState<Permissions>(() => accessOf(person));
  const [values, setValues] = useState<Permissions>(current);
  const [role, setRole] = useState<Role>(person.role);
  const [confirmRole, setConfirmRole] = useState(false);
  const [dialog, setDialog] = useState<"email" | "password" | "details" | "deactivate" | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["adminUsers"] });

  // Only the keys that changed: the server merges a patch onto the stored access.
  const changed = Object.fromEntries(Object.entries(payloadFor(person.role, values)).filter(([k, v]) => v !== current[k as keyof Permissions]));
  const dirty = Object.keys(changed).length > 0;

  const saveAccess = useMutation({
    mutationFn: () => adminApi.updatePermissions(accessToken!, person.id, changed),
    onSuccess: async (saved) => {
      // The server can clamp a grant the editor isn't allowed to give; show what it stored.
      const stored = accessOf(saved);
      const differs = PERMISSION_KEYS.some((k) => values[k] !== stored[k]);
      setCurrent(stored);
      setValues(stored);
      if (differs) toast.warning("Saved, but the server stored something different. You can only give access you have yourself. Check the boxes below.");
      else toast.success(`Access saved for ${nameOf(person)}.`);
    },
    onError: (e) => toast.error(errText(e, "Couldn't save the access.")),
    onSettled: refresh,
  });
  const changeRole = useMutation({
    mutationFn: () => adminApi.updateUserRole(accessToken!, person.id, role),
    onSuccess: () => toast.success(`${nameOf(person)} is now ${ROLE_NAMES[role] === "Admin" ? "an" : "a"} ${ROLE_NAMES[role]}.`),
    onError: (e) => {
      toast.error(errText(e, "Couldn't change the role."));
      setRole(person.role);
    },
    onSettled: () => {
      setConfirmRole(false);
      return refresh();
    },
  });

  const roles = rolesForChange(user).includes(person.role) ? rolesForChange(user) : [person.role, ...rolesForChange(user)];
  const lockedReason = me
    ? "This is you. Ask another admin to change your role or access."
    : !editable && canEditPeople(user)
      ? "Only a full admin can change an admin account."
      : !editable
        ? "You can see access here. Changing it needs the People “edit” permission."
        : null;

  return (
    <>
      <SheetHeader className="gap-3 border-b px-6 py-5 text-left">
        <div className="flex items-center gap-3">
          <UserAvatar name={person.name ?? person.email} size="md" />
          <div className="min-w-0">
            <SheetTitle className="truncate text-h3">{nameOf(person)}</SheetTitle>
            <SheetDescription className="truncate">{[person.email, person.phoneNumber].filter(Boolean).join(" · ") || "No contact details"}</SheetDescription>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill tone="neutral">{ROLE_NAMES[person.role]}</StatusPill>
          {person.email && (person.emailVerifiedAt ? <StatusPill tone="success">Email verified</StatusPill> : <StatusPill tone="warning">Email not verified yet</StatusPill>)}
          {person.deactivatedAt && <StatusPill tone="danger">Deactivated</StatusPill>}
        </div>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-8 px-6 py-6">
        {lockedReason && <p className="rounded-md bg-muted px-3 py-2 text-small text-fg-strong">{lockedReason}</p>}

        {editable && (
          <section aria-labelledby="role-title" className="flex flex-col gap-3">
            <h3 id="role-title" className="text-card-title">
              Role
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={role}
                onValueChange={(v) => {
                  setRole(v as Role);
                  setConfirmRole(false);
                }}
                disabled={changeRole.isPending}
              >
                <SelectTrigger className="min-w-48 flex-1 sm:max-w-64" aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_NAMES[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {role !== person.role &&
                (confirmRole ? (
                  <Button variant="destructive" disabled={changeRole.isPending} onClick={() => changeRole.mutate()}>
                    {changeRole.isPending ? "Changing…" : `Yes, make ${ROLE_NAMES[role]}`}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setConfirmRole(true)}>
                    Change role
                  </Button>
                ))}
            </div>
            {role !== person.role && (
              <p className="text-small text-muted-foreground" role={confirmRole ? "alert" : undefined}>
                Their access goes back to a plain {ROLE_NAMES[role]}&apos;s. Their sessions end, and the new role is fully in force within 15 minutes.
              </p>
            )}
          </section>
        )}

        <section aria-labelledby="access-title" className="flex flex-col gap-3">
          <h3 id="access-title" className="text-card-title">
            {isOwnScopeRole(person.role) ? "Access (their own content only)" : "Access"}
          </h3>
          <AccessEditor value={values} onChange={setValues} role={person.role} disabled={!editable || saveAccess.isPending || role !== person.role} />
          {person.role === "FINANCE" && editable && <p className="text-small text-muted-foreground">A Finance account starts with Finance plus seeing campaigns, creators and content. Tick more to give extra.</p>}
        </section>

        {/* People → Edit details: full admins only (PUT /admin/users/:id/details, POST …/billing-profiles). */}
        {isFullAdmin(user) && <DetailsSection person={person} onEdit={() => setDialog("details")} />}
        {isFullAdmin(user) && <BankSection person={person} />}

        {canEditPeople(user) && !me && (
          <section aria-labelledby="signin-title" className="flex flex-col gap-3">
            <h3 id="signin-title" className="text-card-title">
              Sign-in
            </h3>
            {canTakeOver(user, person) ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setDialog("email")}>
                  <Mail />
                  Change email
                </Button>
                <Button variant="outline" onClick={() => setDialog("password")}>
                  <KeyRound />
                  Reset password
                </Button>
              </div>
            ) : (
              <p className="text-small text-muted-foreground">Only a full admin can change the email or password of an admin, finance or planner account.</p>
            )}
          </section>
        )}

        {/* Deactivate / Reactivate (21 Oct): PUT /admin/users/:id/active, full admins only, never yourself. */}
        {isFullAdmin(user) && !me && <AccountSection person={person} onDeactivate={() => setDialog("deactivate")} onDone={refresh} />}
      </div>

      {editable && (
        <SheetFooter className="sticky bottom-0 mt-auto flex-row gap-2 border-t bg-popover px-6 py-4 sm:justify-start">
          <Button disabled={!dirty || saveAccess.isPending || role !== person.role} onClick={() => saveAccess.mutate()}>
            {saveAccess.isPending ? "Saving…" : "Save access"}
          </Button>
          {dirty && (
            <Button variant="ghost" disabled={saveAccess.isPending} onClick={() => setValues(current)}>
              Undo changes
            </Button>
          )}
        </SheetFooter>
      )}

      <EditDetailsDialog person={dialog === "details" ? person : null} onClose={() => setDialog(null)} />
      <ChangeEmailDialog person={dialog === "email" ? person : null} onClose={() => setDialog(null)} onDone={refresh} />
      <ResetPasswordDialog person={dialog === "password" ? person : null} onClose={() => setDialog(null)} />
      <DeactivateDialog person={dialog === "deactivate" ? person : null} onClose={() => setDialog(null)} onDone={refresh} />
    </>
  );
}

/** Whether the account can sign in. Deactivated keeps every record (pages, posts, invoices, payouts, plans); Reactivate undoes it. */
function AccountSection({ person, onDeactivate, onDone }: { person: User; onDeactivate: () => void; onDone: () => void }) {
  const { accessToken } = useAuth();
  const reactivate = useMutation({
    mutationFn: () => adminApi.setActive(accessToken!, person.id, true),
    onSuccess: () => toast.success(`${nameOf(person)} can sign in again.`),
    onError: (e) => toast.error(errText(e, "Couldn't reactivate the account.")),
    onSettled: onDone,
  });
  const since = person.deactivatedAt ? new Date(person.deactivatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : null;

  return (
    <section aria-labelledby="account-title" className="flex flex-col gap-3">
      <h3 id="account-title" className="text-card-title">
        Account
      </h3>
      {since ? (
        <>
          <p className="rounded-md bg-danger-soft px-3 py-2 text-small text-danger-fg">Deactivated on {since}. They can&apos;t sign in. Everything they&apos;re on stays as it was.</p>
          <Button variant="outline" className="self-start" disabled={reactivate.isPending} onClick={() => reactivate.mutate()}>
            <UserCheck />
            {reactivate.isPending ? "Reactivating…" : "Reactivate account"}
          </Button>
        </>
      ) : (
        <>
          <p className="text-small text-muted-foreground">Deactivating stops them signing in. Their pages, posts, invoices, payouts and plans stay, and you can reactivate them later.</p>
          <Button variant="ghost" className="self-start text-danger-fg hover:text-danger-fg" onClick={onDeactivate}>
            <UserX />
            Deactivate account
          </Button>
        </>
      )}
    </section>
  );
}

/** PUT /admin/users/:id/active { active: false }: confirm first, since it signs them out everywhere. */
function DeactivateDialog({ person, onClose, onDone }: { person: User | null; onClose: () => void; onDone: () => void }) {
  const { accessToken } = useAuth();
  const deactivate = useMutation({
    mutationFn: () => adminApi.setActive(accessToken!, person!.id, false),
    onSuccess: () => {
      toast.success(`${nameOf(person!)} is deactivated and signed out everywhere.`);
      close();
    },
    onSettled: onDone,
  });
  const close = () => {
    deactivate.reset();
    onClose();
  };

  return (
    <Dialog open={!!person} onOpenChange={(o) => !o && !deactivate.isPending && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate {person ? nameOf(person) : "this account"}?</DialogTitle>
          <DialogDescription>They&apos;re signed out of every device and can&apos;t sign in. Their pages, posts, invoices, payouts and plans stay as they are. You can reactivate the account at any time.</DialogDescription>
        </DialogHeader>
        {deactivate.isError && (
          <p role="alert" className="text-small text-danger-helper">
            {errText(deactivate.error, "Couldn't deactivate the account.")}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={deactivate.isPending} onClick={close}>
            Keep active
          </Button>
          <Button variant="destructive" disabled={deactivate.isPending} onClick={() => deactivate.mutate()}>
            {deactivate.isPending ? "Deactivating…" : "Deactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Contact details and address at a glance; the list only carries these for a full admin (admin/routes.js GET /users). */
function DetailsSection({ person, onEdit }: { person: User; onEdit: () => void }) {
  const address = [person.addressLine1, person.addressLine2, [person.state, person.pincode].filter(Boolean).join(" ")].filter((l) => l?.trim());
  return (
    <section aria-labelledby="details-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="details-title" className="text-card-title">
          Details
        </h3>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil />
          Edit details
        </Button>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 rounded-card border p-4 text-small sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Phone</dt>
          <dd className="text-foreground">{person.phoneNumber ?? "Not added"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">WhatsApp number</dt>
          <dd className="text-foreground">{person.secondaryPhone ?? "Not added"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Address</dt>
          <dd className="text-foreground">{address.length ? address.join(", ") : "Not added"}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Their billing profiles. A full admin holds finance.view, so GET /billing-profiles returns everyone's; this filters to theirs. */
function BankSection({ person }: { person: User }) {
  const { user, accessToken } = useAuth();
  const list = useQuery({ queryKey: ["billing", "all"], queryFn: () => billingApi.list(accessToken!), enabled: !!accessToken });
  const theirs = (list.data ?? []).filter((b) => b.userId === person.id);
  const [editing, setEditing] = useState<BillingProfile | "new" | null>(null);

  return (
    <section aria-labelledby="bank-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="bank-title" className="text-card-title">
          Bank details
        </h3>
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus />
          Add
        </Button>
      </div>
      {list.isError ? (
        <LoadError onRetry={() => list.refetch()} what="their bank details" />
      ) : list.isLoading ? (
        <Skeleton className="h-20" />
      ) : theirs.length === 0 ? (
        <p className="text-small text-muted-foreground">No bank details on this account yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {theirs.map((b) => (
            <li key={b.id} className="flex items-start gap-3 rounded-card border p-4">
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
              <Button variant="outline" size="sm" onClick={() => setEditing(b)} aria-label={`Edit bank details ${b.name}`}>
                <Pencil />
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}
      <BankDialog profile={editing} reviewer={hasAccess(user, "finance.edit")} owner={{ id: person.id, name: nameOf(person) }} onClose={() => setEditing(null)} />
    </section>
  );
}

/** PUT /admin/users/:id/email: the new address is their login, starts unverified, and signs them out. */
function ChangeEmailDialog({ person, onClose, onDone }: { person: User | null; onClose: () => void; onDone: () => void }) {
  const { accessToken } = useAuth();
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const same = !!person && email.trim().toLowerCase() === (person.email ?? "").toLowerCase();
  const close = () => {
    setEmail("");
    setTouched(false);
    save.reset();
    onClose();
  };
  const save = useMutation({
    mutationFn: () => adminApi.updateUserEmail(accessToken!, person!.id, email.trim()),
    onSuccess: (r) => {
      toast.success(`${nameOf(person!)} now signs in with ${r.email}. They've been signed out.`);
      onDone();
      close();
    },
  });

  return (
    <Dialog open={!!person} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (valid && !same) save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Change sign-in email</DialogTitle>
            <DialogDescription>
              {person ? nameOf(person) : ""} signs in with {person?.email ?? "no email yet"}. The new address is checked with a code at their next sign-in, and they&apos;re signed out everywhere. Their password stays the same.
            </DialogDescription>
          </DialogHeader>
          <Field label="New email" error={touched && !valid ? "Enter an email like name@gmail.com." : same ? "That's the email they already use." : save.isError ? errText(save.error, "Couldn't change the email.") : null}>
            {(a) => <Input {...a} type="email" autoComplete="off" value={email} onChange={(e) => { setEmail(e.target.value); if (save.isError) save.reset(); }} onBlur={() => setTouched(true)} placeholder="name@gmail.com" maxLength={254} />}
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || same || (touched && !valid)}>
              {save.isPending ? "Changing…" : "Change email"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** POST /admin/users/:id/reset-password: a new password, shown once; they're signed out everywhere. */
function ResetPasswordDialog({ person, onClose }: { person: User | null; onClose: () => void }) {
  const { accessToken } = useAuth();
  const [copied, setCopied] = useState(false);
  const reset = useMutation({ mutationFn: () => adminApi.resetPassword(accessToken!, person!.id) });
  const password = reset.data?.generatedPassword;
  const close = () => {
    setCopied(false);
    reset.reset();
    onClose();
  };

  return (
    <Dialog open={!!person} onOpenChange={(o) => !o && !password && close()}>
      {/* Once a password is showing, only Done closes: a stray click must not lose it. */}
      <DialogContent hideClose={!!password} onInteractOutside={(e) => password && e.preventDefault()} onEscapeKeyDown={(e) => password && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{password ? "New password" : "Reset password?"}</DialogTitle>
          <DialogDescription>
            {password
              ? `Share it with ${person ? nameOf(person) : "them"} now. It won't be shown again. They've been signed out everywhere.`
              : `${person ? nameOf(person) : "They"} get a new password and are signed out of every device. Their current password stops working straight away.`}
          </DialogDescription>
        </DialogHeader>
        {password ? (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border bg-muted px-3 py-2 font-mono text-body-strong" data-testid="generated-password">
              {password}
            </code>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`Email: ${person?.email ?? ""}\nPassword: ${password}`);
                  setCopied(true);
                } catch {
                  toast.error("Couldn't copy. Select the password and copy it by hand.");
                }
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy login"}
            </Button>
          </div>
        ) : (
          reset.isError && (
            <p role="alert" className="text-small text-danger-helper">
              {errText(reset.error, "Couldn't reset the password.")}
            </p>
          )
        )}
        <DialogFooter>
          {password ? (
            <Button onClick={close}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={reset.isPending} onClick={() => reset.mutate()}>
                {reset.isPending ? "Resetting…" : "Reset password"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
