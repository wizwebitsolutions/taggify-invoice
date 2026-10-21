"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, assets as assetsApi, auth as authApi, type Asset } from "@/lib/api-client";
import { canCreateLogin, canSetRatesOnCreate, normalizeHandle, type Grade } from "@/lib/creators";
import { personLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { invalidatePages, usePageOwners } from "@/lib/queries/creators";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchField } from "@/components/taggify/search-field";
import { SegmentedFilter } from "@/components/taggify/segmented-filter";
import { UserAvatar } from "@/components/taggify/user-avatar";
import { emptyRates, rateCardsFrom, RateFields } from "@/components/creators/rate-fields";
import { GradeToggle } from "@/components/creators/page-sheet";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const createErrText = (e: unknown) => errText(e, "Couldn't add the page. Try again.");

type NewLogin = { id: string; name: string | null; email: string; password: string };

/** Used from a campaign's pending sheet row: the handle comes pre-filled and the new page is matched to the row once saved. */
export type AddPagePrefill = { handle: string; note?: string; ownerSearch?: string; onCreated: (page: Asset) => Promise<void> };

/**
 * Staff "Add page": register an Instagram page under a creator (vendor) account —
 * an existing one, or a new login created in the same submit. The new login's
 * one-time password is shown once, after the page exists, so an abandoned form
 * never leaves an orphan account. A page an admin adds is approved on the spot
 * (server rule); a planner's waits for approval.
 */
export function AddPageDialog({ open, onOpenChange, prefill }: { open: boolean; onOpenChange: (o: boolean) => void; prefill?: AddPagePrefill }) {
  // A login created before its page saved lives here, above the form, so closing the
  // dialog can't lose its one-time password and reopening reuses it (no second account).
  const [login, setLogin] = useState<NewLogin | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  function close() {
    if (login && !confirmClose) return setConfirmClose(true);
    setConfirmClose(false);
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-lg">
        {open && confirmClose && login ? (
          <>
            <DialogHeader>
              <DialogTitle>Close without the page?</DialogTitle>
              <DialogDescription>
                The login for {login.email} exists but has no page yet. Copy its password now: <code className="font-mono font-semibold">{login.password}</code>. You can come back and add the page to it.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmClose(false)}>
                Keep adding
              </Button>
              <Button
                onClick={() => {
                  setConfirmClose(false);
                  onOpenChange(false);
                }}
              >
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          open && <AddPageForm login={login} setLogin={setLogin} prefill={prefill} onClose={close} onFinished={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddPageForm({ login, setLogin, prefill, onClose, onFinished }: { login: NewLogin | null; setLogin: (l: NewLogin | null) => void; prefill?: AddPagePrefill; onClose: () => void; onFinished: () => void }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const owners = usePageOwners();
  const mayCreateLogin = canCreateLogin(user);
  const withRates = canSetRatesOnCreate(user);

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [ownerQ, setOwnerQ] = useState(prefill?.ownerSearch ?? "");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [handle, setHandle] = useState(prefill?.handle ?? "");
  const [category, setCategory] = useState("");
  const [grade, setGrade] = useState<Grade | "">("");
  const [groupLink, setGroupLink] = useState("");
  const [rates, setRates] = useState(emptyRates);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<{ handle: string; approved: boolean; login: NewLogin } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (owners.isSuccess && owners.data.length === 0 && mayCreateLogin) setMode("new");
  }, [owners.isSuccess, owners.data, mayCreateLogin]);

  const needle = ownerQ.trim().toLowerCase();
  const allMatches = useMemo(() => (owners.data ?? []).filter((o) => !needle || `${o.name ?? ""} ${o.email ?? ""} ${o.phoneNumber ?? ""}`.toLowerCase().includes(needle)), [owners.data, needle]);
  const matches = allMatches.slice(0, 8);
  const totalMatches = allMatches.length;
  const chosen = (owners.data ?? []).find((o) => o.id === ownerId) ?? null;

  const clean = normalizeHandle(handle);
  const emailOk = /^\S+@\S+\.\S+$/.test(newEmail.trim());
  const rateOk = (v: string) => v.trim() === "" || (/^\d+$/.test(v.trim()) && Number(v) > 0);
  const badLink = groupLink.trim() !== "" && !/^https?:\/\/\S+\.\S+/.test(groupLink.trim());
  const errors = {
    owner: login ? null : mode === "new" ? (emailOk ? null : "Enter the new creator's email. It's their login.") : ownerId ? null : "Pick the creator this page belongs to.",
    handle: !handle.trim() ? "Enter the page's Instagram handle." : clean ? null : "That isn't an Instagram handle or profile link.",
    // No rate is mandatory (16 Oct); a typed one just has to be a whole rupee amount.
    rates: !Object.values(rates).every(rateOk) ? "Rates are whole rupees above ₹0." : null,
    groupLink: badLink ? "The group link needs to be a full web address (https://…)." : null,
  };
  const valid = !errors.owner && !errors.handle && !errors.rates && !errors.groupLink;

  const create = useMutation({
    mutationFn: async () => {
      let made = login;
      let owner = made?.id ?? (mode === "existing" ? ownerId : null);
      if (!owner) {
        let r;
        try {
          r = await authApi.signup(accessToken!, { email: newEmail.trim(), name: newName.trim() || undefined, role: "CREATOR" });
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) throw new Error("That email already has an account. Pick them under Existing creator.");
          throw e;
        }
        made = { id: r.user.id, name: r.user.name, email: r.user.email ?? newEmail.trim(), password: r.generatedPassword };
        setLogin(made);
        owner = r.user.id;
      }
      const rateCards = withRates ? rateCardsFrom(rates) : [];
      const asset = await assetsApi.create(accessToken!, clean!, "instagram", {
        ownerId: owner,
        ...(category.trim() ? { category: category.trim() } : {}),
        ...(grade ? { grade } : {}),
        ...(groupLink.trim() ? { groupLink: groupLink.trim() } : {}),
        ...(rateCards.length ? { rateCards } : {}),
      });
      return { asset, made };
    },
    onSuccess: async ({ asset: a, made }) => {
      const approved = a.approvalStatus === "approved";
      if (made) {
        // The page exists: the login is no longer at risk, so closing won't ask. The success screen keeps its own copy.
        // Shown before the sheet-row match below, so closing mid-match can't hide the one-time password.
        setDone({ handle: a.handle, approved, login: made });
        setLogin(null);
      }
      await invalidatePages(qc);
      // The page exists either way; a failed match is reported but doesn't undo it (Match → Existing page finishes it).
      if (prefill) {
        try {
          await prefill.onCreated(a);
        } catch (e) {
          toast.error(`${a.handle.replace(/^@+/, "")} was added, but matching it to the sheet row failed. Use Match on that row to finish. (${errText(e, "Unknown error").replace(/\.$/, "")})`);
        }
      }
      if (!made) {
        // From a sheet row, onCreated reports the add and the match in one toast.
        if (!prefill) toast.success(`${a.handle} added${approved ? "" : ". It's waiting for approval"}.`);
        onFinished();
      }
    },
    onSettled: () => owners.refetch(),
  });

  if (done) {
    const login = done.login;
    return (
      <>
        <DialogHeader>
          <DialogTitle>{done.handle} added</DialogTitle>
          <DialogDescription>{done.approved ? "The page is live in Inventory." : "The page is waiting for approval."} Share the new login with the creator now. The password won&apos;t be shown again.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 rounded-card border p-4">
          <div className="flex items-center gap-3">
            <UserAvatar name={login.name ?? login.email} size="sm" />
            <span className="min-w-0">
              <span className="block truncate text-body-strong">{login.name ?? "New creator"}</span>
              <span className="block truncate text-small text-muted-foreground">{login.email}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border bg-muted px-3 py-2 font-mono text-body-strong" data-testid="generated-password">
              {login.password}
            </code>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`Email: ${login.email}\nPassword: ${login.password}`);
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
          <p className="text-small text-muted-foreground">They sign in with this email and confirm a code we email them.</p>
        </div>
        <DialogFooter>
          <Button onClick={onFinished}>Done</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (valid) create.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{prefill ? "Add as a new page" : "Add a page"}</DialogTitle>
        <DialogDescription>
          {prefill ? `Register the page from the campaign sheet under the creator who gets paid for it. It's matched to the sheet row once it's saved.${prefill.note ? ` ${prefill.note}` : ""}` : "Register an Instagram page under the creator who gets paid for it. Followers and recent posts are fetched automatically."}
        </DialogDescription>
      </DialogHeader>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-body-strong">Creator (vendor)</legend>
        {login ? (
          <div className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2 text-small">
            <span>
              New login created for <span className="font-semibold">{login.email}</span>. Saving again adds the page to it.
            </span>
            {/* Shown here too: if the page save failed, closing now must not lose the one-time password. */}
            <span>
              Password: <code className="font-mono font-semibold">{login.password}</code> (copy it now; it won&apos;t be shown again)
            </span>
          </div>
        ) : (
          <>
            {mayCreateLogin && (
              <SegmentedFilter
                label="Creator account"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "existing", label: "Existing creator" },
                  { value: "new", label: "New creator" },
                ]}
                className="self-start"
              />
            )}
            {mode === "existing" ? (
              <div className="flex flex-col gap-2">
                <SearchField label="Find a creator" placeholder="Search name, email or phone..." value={ownerQ} onChange={(e) => setOwnerQ(e.target.value)} />
                <ul aria-label="Creators" className="max-h-56 overflow-y-auto rounded-md border">
                  {owners.isLoading ? (
                    <li className="px-3 py-2 text-small text-muted-foreground">Loading creators…</li>
                  ) : matches.length === 0 ? (
                    <li className="px-3 py-2 text-small text-muted-foreground">No creator matches.{mayCreateLogin ? " Switch to New creator to make one." : ""}</li>
                  ) : (
                    matches.map((o) => (
                      <li key={o.id}>
                        <button type="button" aria-pressed={o.id === ownerId} onClick={() => setOwnerId(o.id)} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent", o.id === ownerId && "bg-brand-soft")}>
                          <UserAvatar name={personLabel(o)} size="xs" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body-strong">{personLabel(o)}</span>
                            {o.name && <span className="block truncate text-small text-muted-foreground">{o.email ?? o.phoneNumber}</span>}
                          </span>
                          {o.id === ownerId && <Check className="h-4 w-4 text-brand-ink" aria-hidden />}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                {totalMatches > matches.length && <p className="text-small text-muted-foreground">Showing {matches.length} of {totalMatches}. Type more of the name to narrow it down.</p>}
                {chosen && <p className="text-small text-muted-foreground">Selected: {personLabel(chosen)}</p>}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="np-name">
                    Name <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input id="np-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="np-email">Email (their login)</Label>
                  <Input id="np-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                </div>
              </div>
            )}
          </>
        )}
        {tried && errors.owner && <p className="text-small text-danger-helper">{errors.owner}</p>}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="np-handle">Instagram handle or link</Label>
          <Input id="np-handle" placeholder="@riya.eats" value={handle} onChange={(e) => setHandle(e.target.value)} aria-invalid={tried && !!errors.handle} />
          {tried && errors.handle && <p className="text-small text-danger-helper">{errors.handle}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="np-category">
            Category <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="np-category" maxLength={40} placeholder="e.g. Food" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div className="flex flex-col gap-2">
          <span className="text-label font-medium">
            Grade <span className="font-normal text-muted-foreground">(optional)</span>
          </span>
          <GradeToggle value={grade} onChange={setGrade} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="np-group">
            Group link <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="np-group" type="url" placeholder="https://chat.whatsapp.com/…" value={groupLink} onChange={(e) => setGroupLink(e.target.value)} aria-invalid={tried && !!errors.groupLink} />
          {tried && errors.groupLink && <p className="text-small text-danger-helper">{errors.groupLink}</p>}
        </div>
      </div>

      {withRates ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-body-strong">
            Rates <span className="font-normal text-muted-foreground">(₹ per post)</span>
          </legend>
          <RateFields idPrefix="np" values={rates} onChange={setRates} />
          {tried && errors.rates && <p className="text-small text-danger-helper">{errors.rates}</p>}
        </fieldset>
      ) : (
        <p className="text-small text-muted-foreground">The page waits for an admin to approve it; rates can be added by an admin later.</p>
      )}

      {create.isError && (
        <p className="text-small text-danger-helper" role="alert">
          {createErrText(create.error)}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Adding…" : prefill ? "Add and match" : "Add page"}
        </Button>
      </DialogFooter>
    </form>
  );
}
