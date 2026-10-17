"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { personLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PhoneField } from "@/components/ui/form-field";
import { RateFields, rateCardsFrom, missingRequiredRates } from "@/components/inventory/rate-fields";
import { useAuth } from "@/lib/auth-context";
import { Sheet } from "@/components/ui/sheet";
import { CategoryPicker } from "@/components/ui/category-picker";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { CheckCircleIcon, SearchIcon } from "@/components/icons";
import {
  campaigns as campaignsApi,
  assets as assetsApi,
  auth as authApi,
  admin as adminApi,
  ApiError,
  type CampaignAssignment,
  type User,
} from "@/lib/api-client";

/**
 * "Next step" from newTask.md #8: rows from a campaign's attached sheet
 * that didn't match an existing page, with the option to create each one
 * right here. Reachable from both the campaigns list (the card's pending
 * badge) and the campaign detail page (bugs.md #7) — pulled out to its own
 * file, rather than living inside app/campaigns/page.tsx, since a
 * `page.tsx` file may only export the specific names Next's App Router
 * expects (default, metadata, ...) and nothing else.
 */
export function ResolvePendingAssignmentsModal({
  token,
  campaignId,
  campaignTitle,
  onClose,
  onResolved,
}: {
  token: string;
  campaignId: string;
  campaignTitle: string;
  onClose: () => void;
  onResolved: () => void;
}) {
  const queryClient = useQueryClient();
  const assignmentsQuery = useQuery({
    queryKey: ["campaignAssignments", campaignId],
    queryFn: () => campaignsApi.listAssignments(token, campaignId),
  });

  const pending = (assignmentsQuery.data ?? []).filter((a) => a.status === "pending");
  const matchedCount = (assignmentsQuery.data ?? []).length - pending.length;

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[520px]">
      <div className="flex flex-1 min-h-0 flex-col gap-5 overflow-y-auto p-6 pt-1">
        <div>
          <h2 className="text-lg font-semibold">Pending pages · {campaignTitle}</h2>
          <p className="text-[0.8125rem] text-text-faint">
            {matchedCount} row{matchedCount === 1 ? "" : "s"} matched an existing page. {pending.length} still need
            one created.
          </p>
        </div>

        {assignmentsQuery.isLoading ? (
          <TableSkeleton />
        ) : pending.length === 0 ? (
          <EmptyState label="All rows are matched." />
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((a) => (
              <PendingAssignmentRow
                key={a.id}
                token={token}
                campaignId={campaignId}
                assignment={a}
                onResolved={() => {
                  queryClient.invalidateQueries({ queryKey: ["campaignAssignments", campaignId] });
                  onResolved();
                }}
              />
            ))}
          </div>
        )}

        <Button variant="ghost" onClick={onClose}>
          Done for now
        </Button>
      </div>
    </Sheet>
  );
}

function PendingAssignmentRow({
  token,
  campaignId,
  assignment,
  onResolved,
}: {
  token: string;
  campaignId: string;
  assignment: CampaignAssignment;
  onResolved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [phone, setPhone] = useState(assignment.creatorPhone?.replace(/^\+91/, "") ?? "");
  const [name, setName] = useState("");
  // Email is the new account's login (24 Sep) — required; phone optional.
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("");
  const [rates, setRates] = useState<Record<string, string>>({});
  // Only a full admin can set rates, and their page is approved on creation —
  // so Reel and Story are required up front (14 Oct).
  const { user } = useAuth();
  const isFullAdmin = user?.role === "ADMIN";
  const [attempted, setAttempted] = useState(false);
  const ratesMissing = isFullAdmin && missingRequiredRates(rates).length > 0;
  const [phoneBlurred, setPhoneBlurred] = useState(false);
  // "Option of creating account under user" (user request, 12 Sep): the
  // page can be attached to a creator who already has an account instead
  // of always minting a new one. `mode` is null until the users list has
  // loaded, so the row can pick the right default: if the sheet's phone
  // already belongs to someone, start in "existing" with them selected —
  // otherwise "new".
  const [mode, setMode] = useState<"new" | "existing" | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");

  const usersQuery = useQuery({ queryKey: ["adminUsers"], queryFn: () => adminApi.users(token), enabled: expanded });
  const creators = useMemo(
    () => (usersQuery.data ?? []).filter((u: User) => u.role === "CREATOR" || u.role === "TEAM_MEMBER"),
    [usersQuery.data]
  );
  const sheetPhone = assignment.creatorPhone ? `+91${assignment.creatorPhone.replace(/\D/g, "").slice(-10)}` : null;
  const phoneOwner = sheetPhone ? creators.find((u) => u.phoneNumber === sheetPhone) : undefined;
  if (mode === null && usersQuery.isSuccess) {
    setMode(phoneOwner ? "existing" : "new");
    if (phoneOwner) setExistingId(phoneOwner.id);
  }
  const visibleCreators = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    const list = q ? creators.filter((u) => (u.name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q) || (u.phoneNumber ?? "").includes(q)) : creators;
    return list.slice(0, 8);
  }, [creators, userSearch]);
  const selectedUser = creators.find((u) => u.id === existingId) ?? null;

  // Same signup call and rules as CreateUserModal (app/users/page.tsx):
  // email required; phone optional, but a full 10 digits if given (a
  // partial number used to reach the server as "+91123", bugs.md #3/#4).
  const emailValid = /^\S+@\S+\.\S+$/.test(email.trim());
  const phoneDigits = phone.replace(/\D/g, "");
  const phoneValid = phoneDigits.length === 0 || phoneDigits.length === 10;
  const showPhoneError = phoneBlurred && !phoneValid;
  const canSubmit = mode === "existing" ? Boolean(existingId) : emailValid && phoneValid;

  const resolveMutation = useMutation({
    mutationFn: async () => {
      let ownerId: string;
      let generatedPassword: string | null = null;
      if (mode === "existing") {
        ownerId = existingId!;
      } else {
        // The email or phone might already belong to an existing creator
        // (this page's owner just hadn't registered this particular handle
        // yet) — reuse them instead of erroring, rather than forcing a
        // duplicate account.
        try {
          const signupResult = await authApi.signup(token, {
            email: email.trim(),
            phoneNumber: phoneDigits ? `+91${phoneDigits}` : undefined,
            name: name || undefined,
            role: "CREATOR",
          });
          ownerId = signupResult.user.id;
          generatedPassword = signupResult.generatedPassword;
        } catch (err) {
          // Same email = same person: reuse that account. A phone that's
          // already someone else's is NOT reused silently (24 Sep review) —
          // the admin typed a different email, so say so and let them choose.
          if (err instanceof ApiError && err.code === "PHONE_ALREADY_REGISTERED") {
            const allUsers = await adminApi.users(token);
            const holder = allUsers.find((u) => u.phoneNumber === `+91${phoneDigits}`);
            throw new ApiError(
              409,
              err.code,
              holder
                ? `That phone number already belongs to ${personLabel(holder)}. Use "Existing user" to attach the page to them, or clear the phone.`
                : "That phone number is already registered — clear it or use a different one."
            );
          }
          if (!(err instanceof ApiError && err.code === "EMAIL_ALREADY_REGISTERED")) throw err;
          const allUsers = await adminApi.users(token);
          const existing = allUsers.find((u) => u.email?.toLowerCase() === email.trim().toLowerCase());
          if (!existing) throw err;
          ownerId = existing.id;
        }
      }

      const rateCards = isFullAdmin ? rateCardsFrom(rates) : [];
      const asset = await assetsApi.create(token, assignment.pageHandle, "instagram", {
        category: category || undefined,
        ownerId,
        ...(rateCards.length > 0 ? { rateCards } : {}),
      });
      await campaignsApi.resolveAssignment(token, campaignId, assignment.id, asset.id);
      return generatedPassword;
    },
    onSuccess: onResolved,
  });

  if (resolveMutation.isSuccess) {
    return (
      <div className="flex items-center gap-2.5 rounded-md border border-accent/25 bg-accent-soft px-3.5 py-3 text-[0.8125rem]">
        <CheckCircleIcon className="h-4 w-4 shrink-0 text-accent" />
        <span>
          @{assignment.pageHandle} {mode === "existing" && selectedUser ? `attached to ${personLabel(selectedUser)}.` : "created."}
          {resolveMutation.data && (
            <>
              {" "}
              Password: <span className="font-mono font-semibold">{resolveMutation.data}</span> — share it now, it can't be shown again.
            </>
          )}
        </span>
      </div>
    );
  }

  const modeTabs: { key: "new" | "existing"; label: string }[] = [
    { key: "new", label: "New creator account" },
    { key: "existing", label: "Existing user" },
  ];

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border p-3.5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[0.8125rem] font-semibold">@{assignment.pageHandle}</p>
          {assignment.creatorPhone && <p className="text-[0.75rem] text-text-faint">{assignment.creatorPhone}</p>}
          {/* newTask.md, 8 Sep — the row already names a posted link; once
              this page is created and matched, resolveAssignment attaches
              it automatically, no separate submission needed. */}
          {assignment.postUrl && !assignment.linkId && (
            <p className="mt-0.5 text-[0.75rem] text-accent">Also names a post — attached automatically once created.</p>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Cancel" : "Create"}
        </Button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2.5 border-t border-border pt-3">
          <div role="tablist" aria-label="Who owns this page" className="flex rounded-md bg-surface-2 p-0.5 ring-1 ring-inset ring-border">
            {modeTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={mode === t.key}
                onClick={() => setMode(t.key)}
                className={cn(
                  "flex-1 rounded-[6px] px-2 py-1.5 text-[0.75rem] font-semibold transition-colors",
                  mode === t.key ? "bg-surface text-text shadow-card" : "text-text-faint hover:text-text-muted"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          {phoneOwner && mode === "existing" && existingId === phoneOwner.id && (
            <p className="text-[0.75rem] text-accent">
              The sheet's phone number already belongs to {personLabel(phoneOwner)} — attaching to them.
            </p>
          )}

          {mode === "existing" ? (
            <div className="flex flex-col gap-2">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
                <input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search creators by name, email or phone…"
                  aria-label="Search existing users"
                  className="h-9 w-full rounded-md border border-border-strong bg-surface-2 pl-8 pr-2.5 text-[0.8125rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30"
                />
              </div>
              {usersQuery.isLoading ? (
                <p className="text-[0.75rem] text-text-faint">Loading users…</p>
              ) : visibleCreators.length === 0 ? (
                <p className="text-[0.75rem] text-text-faint">No creator matches — switch to "New creator account" to add one.</p>
              ) : (
                <div role="radiogroup" aria-label="Existing user" className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                  {visibleCreators.map((u) => {
                    const on = u.id === existingId;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setExistingId(u.id)}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                          on ? "border-ink bg-surface-2" : "border-border hover:border-border-strong"
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[0.8125rem] font-semibold">{u.name ?? "Unnamed"}</span>
                          <span className="block text-[0.6875rem] text-text-faint">
                            {u.email ?? u.phoneNumber ?? "—"} · {u.role === "TEAM_MEMBER" ? "Team member" : "Creator"}
                          </span>
                        </span>
                        {on && <CheckCircleIcon className="h-4 w-4 shrink-0 text-accent" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Creator's email (their login)"
                aria-label="Creator's email"
                className="h-9 w-full rounded-md border border-border-strong bg-surface-2 px-2.5 text-[0.8125rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30"
              />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Creator's name (optional)"
                className="h-9 w-full rounded-md border border-border-strong bg-surface-2 px-2.5 text-[0.8125rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30"
              />
              <PhoneField size="sm" value={phone} onChange={setPhone} onBlur={() => setPhoneBlurred(true)} placeholder="Phone (optional)" error={showPhoneError ? "Enter a valid 10-digit mobile number, or leave it empty." : null} />
            </>
          )}
          <CategoryPicker value={category} onChange={setCategory} />
          {isFullAdmin && <RateFields compact rates={rates} onChange={setRates} required showErrors={attempted} />}
          {resolveMutation.isError && (
            <ErrorNotice message={resolveMutation.error instanceof ApiError ? resolveMutation.error.message : "Couldn't create this page."} />
          )}
          <Button
            size="sm"
            onClick={() => {
              setAttempted(true);
              if (ratesMissing) return;
              resolveMutation.mutate();
            }}
            disabled={!canSubmit || resolveMutation.isPending}
          >
            {resolveMutation.isPending ? (mode === "existing" ? "Attaching…" : "Creating…") : mode === "existing" ? "Attach page" : "Create page"}
          </Button>
        </div>
      )}
    </div>
  );
}
