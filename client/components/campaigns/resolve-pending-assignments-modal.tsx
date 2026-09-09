"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { CategoryPicker } from "@/components/ui/category-picker";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { CheckCircleIcon } from "@/components/icons";
import {
  campaigns as campaignsApi,
  assets as assetsApi,
  auth as authApi,
  admin as adminApi,
  LINK_FORMATS,
  ApiError,
  type CampaignAssignment,
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
          <h2 className="text-lg font-bold">Pending pages · {campaignTitle}</h2>
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
  const [category, setCategory] = useState("");
  const [rates, setRates] = useState<Record<string, string>>({});
  const [phoneBlurred, setPhoneBlurred] = useState(false);

  // Same signup call, same 10-digit requirement, as CreateUserModal
  // (app/users/page.tsx) — this row also calls authApi.signup with a
  // "+91"-prefixed phone number to create a brand-new creator account for
  // an unmatched page. It used to only check "non-empty" (bugs.md #3/#4).
  const phoneDigits = phone.replace(/\D/g, "");
  const phoneValid = phoneDigits.length === 10;
  const showPhoneError = phoneBlurred && !phoneValid;

  const resolveMutation = useMutation({
    mutationFn: async () => {
      // The phone might already belong to an existing creator (this page's
      // owner just hadn't registered this particular handle yet) — reuse
      // them instead of erroring, rather than forcing a duplicate account.
      let ownerId: string;
      let generatedPassword: string | null = null;
      try {
        const signupResult = await authApi.signup(token, {
          phoneNumber: `+91${phoneDigits}`,
          name: name || undefined,
          role: "CREATOR",
        });
        ownerId = signupResult.user.id;
        generatedPassword = signupResult.generatedPassword;
      } catch (err) {
        if (err instanceof ApiError && err.code === "PHONE_ALREADY_REGISTERED") {
          const allUsers = await adminApi.users(token);
          const existing = allUsers.find((u) => u.phoneNumber === `+91${phoneDigits}`);
          if (!existing) throw err;
          ownerId = existing.id;
        } else {
          throw err;
        }
      }

      const asset = await assetsApi.create(token, assignment.pageHandle, "instagram", {
        category: category || undefined,
        ownerId,
      });
      const rateCards = Object.entries(rates)
        .filter(([, amount]) => amount.trim())
        .map(([format, amount]) => ({ format, amount: Number(amount) }));
      if (rateCards.length > 0) await assetsApi.updateRateCard(token, asset.id, rateCards);
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
          @{assignment.pageHandle} created.
          {resolveMutation.data && (
            <>
              {" "}
              Password: <span className="font-mono font-bold">{resolveMutation.data}</span> — share it now, it can't be shown again.
            </>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border p-3.5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[0.8125rem] font-bold">@{assignment.pageHandle}</p>
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
          <div
            className={cn(
              "flex h-9 items-center gap-2 rounded-md border bg-surface-2 px-2.5",
              showPhoneError ? "border-rose" : "border-border-strong"
            )}
          >
            <span className="text-[0.8125rem] text-text-faint">+91</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => setPhoneBlurred(true)}
              placeholder="Creator's phone number"
              aria-invalid={showPhoneError}
              className="w-full bg-transparent text-[0.8125rem] text-text placeholder:text-text-faint focus:outline-none"
            />
          </div>
          {showPhoneError && <p className="text-[0.75rem] text-rose">Enter a valid 10-digit mobile number.</p>}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Creator's name (optional)"
            className="h-9 w-full rounded-md border border-border-strong bg-surface-2 px-2.5 text-[0.8125rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <CategoryPicker value={category} onChange={setCategory} />
          <div className="grid grid-cols-2 gap-2">
            {LINK_FORMATS.map((format) => (
              <div key={format} className="flex items-center justify-between gap-2">
                <span className="text-[0.75rem] capitalize text-text-faint">{format}</span>
                <input
                  type="number"
                  min={0}
                  value={rates[format] ?? ""}
                  onChange={(e) => setRates((prev) => ({ ...prev, [format]: e.target.value }))}
                  placeholder="₹ rate"
                  className="h-7 w-20 rounded-md border border-border-strong bg-surface-2 px-2 text-right text-[0.75rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            ))}
          </div>
          {resolveMutation.isError && (
            <ErrorNotice message={resolveMutation.error instanceof ApiError ? resolveMutation.error.message : "Couldn't create this page."} />
          )}
          <Button size="sm" onClick={() => resolveMutation.mutate()} disabled={!phoneValid || resolveMutation.isPending}>
            {resolveMutation.isPending ? "Creating…" : "Create page"}
          </Button>
        </div>
      )}
    </div>
  );
}
