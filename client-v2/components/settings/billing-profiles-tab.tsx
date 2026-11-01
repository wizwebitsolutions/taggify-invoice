"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, Pencil } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, billing as billingApi, hasAccess, type BillingProfile } from "@/lib/api-client";
import { canApproveBilling, canEditBillingOf } from "@/lib/settings";
import { personLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/taggify/illustration";
import { SearchField } from "@/components/taggify/search-field";
import { SegmentedFilter } from "@/components/taggify/segmented-filter";
import { StatusPill } from "@/components/taggify/status-pill";
import { UserAvatar } from "@/components/taggify/user-avatar";
import { Pager, PER_PAGE } from "@/components/finance/pager";
import { LoadError } from "@/components/finance/states";
import { APPROVAL, BankDialog } from "@/components/settings/profile-tab";

type Status = BillingProfile["approvalStatus"];
const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const ownerName = (b: BillingProfile) => personLabel(b.user, b.name);
const added = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const RANK: Record<Status, number> = { pending: 0, rejected: 1, approved: 2 };

/**
 * Billing profiles (v1 /profile → Billing for Admin and Finance): every
 * account's bank details in one list. GET /billing-profiles returns everyone's
 * for finance.view; editing someone else's needs finance.edit and approving
 * needs finance.pay (billing/routes.js), so those controls follow the same keys.
 */
export function BillingProfilesTab() {
  const { user, accessToken } = useAuth();
  // Same key as Approvals and Payouts, so a change here updates their counts too.
  const list = useQuery({ queryKey: ["billing", "all"], queryFn: () => billingApi.list(accessToken!), enabled: !!accessToken });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | Status>("all");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const all = useMemo(() => [...(list.data ?? [])].sort((a, b) => RANK[a.approvalStatus] - RANK[b.approvalStatus] || b.createdAt.localeCompare(a.createdAt)), [list.data]);
  const counts = useMemo(() => {
    const c: Record<Status, number> = { pending: 0, approved: 0, rejected: 0 };
    all.forEach((b) => c[b.approvalStatus]++);
    return c;
  }, [all]);
  const needle = q.trim().toLowerCase();
  const rows = all.filter(
    (b) => (status === "all" || b.approvalStatus === status) && (!needle || `${b.name} ${b.user?.name ?? ""} ${b.user?.email ?? ""} ${b.user?.phoneNumber ?? ""} ${b.pan} ${b.gstin ?? ""}`.toLowerCase().includes(needle))
  );
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  // Looked up by id so the sheet shows the saved values after an edit or decision.
  const open = all.find((b) => b.id === openId) ?? null;

  return (
    <>
      <div className="filter-bar">
        <SearchField
          label="Search bank details"
          placeholder="Search person, PAN or GSTIN..."
          className="w-full sm:w-80"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <SegmentedFilter
          label="Approval"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All", count: all.length },
            { value: "pending", label: "Waiting", count: counts.pending },
            { value: "approved", label: "Approved", count: counts.approved },
            { value: "rejected", label: "Rejected", count: counts.rejected },
          ]}
        />
      </div>

      {list.isError ? (
        <LoadError onRetry={() => list.refetch()} what="bank details" />
      ) : list.isLoading ? (
        <div className="flex flex-col gap-3 px-5 pb-5" aria-busy="true" aria-label="Loading bank details">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState name="empty-search" title={all.length === 0 ? "No bank details yet" : "Nothing matches"}>
          {all.length === 0 ? "Creators add their bank details from their profile to get paid." : "Try another name or PAN, or show all."}
        </EmptyState>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead className="hidden md:table-cell">PAN</TableHead>
                <TableHead className="hidden lg:table-cell">Bank account</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((b) => (
                <TableRow key={b.id} data-testid={`billing-row-${b.id}`}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-3">
                      <UserAvatar name={ownerName(b)} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-body-strong">
                          {ownerName(b)}
                          {b.userId === user?.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                        </span>
                        <span className="block truncate text-small text-muted-foreground">{b.user?.email ?? b.user?.phoneNumber ?? b.name}</span>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="block font-mono text-small text-foreground">{b.pan}</span>
                    {b.gstin && <span className="block font-mono text-small text-muted-foreground">GSTIN {b.gstin}</span>}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-small text-muted-foreground lg:table-cell">
                    •••• {b.bankAccountNumber.slice(-4)} · {b.ifscCode}
                  </TableCell>
                  <TableCell>
                    <StatusPill tone={APPROVAL[b.approvalStatus].tone}>{APPROVAL[b.approvalStatus].label}</StatusPill>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => setOpenId(b.id)} aria-label={`View bank details ${b.pan} for ${ownerName(b)}`}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager total={rows.length} page={current} pages={pages} noun={rows.length === 1 ? "profile" : "profiles"} onPage={setPage} />
        </>
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl md:max-w-xl">{open && <ProfileDetails key={open.id} profile={open} />}</SheetContent>
      </Sheet>
    </>
  );
}

/** Every field, account number hidden until asked for, Edit and (for finance.pay) Approve / Reject. */
function ProfileDetails({ profile: b }: { profile: BillingProfile }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const [reveal, setReveal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const mine = b.userId === user?.id;
  const canEdit = canEditBillingOf(user, b.userId);
  // v1: a decision is offered on profiles still waiting for one.
  const canDecide = canApproveBilling(user) && b.approvalStatus === "pending";

  const decide = useMutation({
    mutationFn: (to: Status) => billingApi.setApproval(accessToken!, b.id, to),
    onSuccess: (_r, to) => {
      setConfirmReject(false);
      toast.success(`Bank details ${to}: ${ownerName(b)}`);
    },
    onError: (e) => toast.error(errText(e, "That decision didn't go through. Try again.")),
    // ["billing"] also feeds the Approvals queue and its counts; payouts check the approval before paying.
    onSettled: () => Promise.all(["billing", "payments"].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  });

  const fields: [string, React.ReactNode][] = [
    ["Name on PAN", b.name],
    ["PAN", <span key="pan" className="font-mono">{b.pan}</span>],
    ["GSTIN", b.gstin ? <span key="gstin" className="font-mono">{b.gstin}</span> : "Not registered"],
    ["MSME number", b.msme || "Not added"],
    ["IFSC", <span key="ifsc" className="font-mono">{b.ifscCode}</span>],
    ["Added", added(b.createdAt)],
  ];

  return (
    <>
      <SheetHeader className="gap-3 border-b px-6 py-5 text-left">
        <div className="flex items-center gap-3">
          <UserAvatar name={ownerName(b)} size="md" />
          <div className="min-w-0">
            <SheetTitle className="truncate text-h3">
              {ownerName(b)}
              {mine && <span className="font-normal text-muted-foreground"> (you)</span>}
            </SheetTitle>
            <SheetDescription className="truncate">{[b.user?.email, b.user?.phoneNumber].filter(Boolean).join(" · ") || "No contact details"}</SheetDescription>
          </div>
        </div>
        <StatusPill className="self-start" tone={APPROVAL[b.approvalStatus].tone}>
          {APPROVAL[b.approvalStatus].label}
        </StatusPill>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-6 px-6 py-6">
        <section aria-labelledby="billing-detail-title" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 id="billing-detail-title" className="text-card-title">
              Bank details
            </h3>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </Button>
            )}
          </div>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 rounded-card border p-4 text-small sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Account number</dt>
              <dd className="flex items-center gap-2 text-foreground">
                <span className="font-mono" data-testid="account-number">
                  {reveal ? b.bankAccountNumber : `•••• ${b.bankAccountNumber.slice(-4)}`}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>
                  {reveal ? <EyeOff /> : <Eye />}
                  {reveal ? "Hide" : "Show"}
                </Button>
              </dd>
            </div>
            {fields.map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        {confirmReject && (
          <p role="alert" className="rounded-md bg-muted px-3 py-2 text-small text-fg-strong">
            Finance won&apos;t pay into these bank details until {mine ? "you fix" : "the creator fixes"} and resubmits them.
          </p>
        )}
      </div>

      {canDecide && (
        <SheetFooter className="sticky bottom-0 mt-auto flex-row gap-2 border-t bg-popover px-6 py-4 sm:justify-start">
          <Button disabled={decide.isPending} onClick={() => decide.mutate("approved")}>
            Approve
          </Button>
          {confirmReject ? (
            <>
              <Button variant="destructive" disabled={decide.isPending} onClick={() => decide.mutate("rejected")}>
                Yes, reject
              </Button>
              <Button variant="ghost" disabled={decide.isPending} onClick={() => setConfirmReject(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button variant="outline" disabled={decide.isPending} onClick={() => setConfirmReject(true)}>
              Reject
            </Button>
          )}
        </SheetFooter>
      )}

      {/* Same form as My profile and the person sheet; a finance.edit holder's edit keeps the approval (billing/service.js update). */}
      <BankDialog profile={editing ? b : null} reviewer={hasAccess(user, "finance.edit")} owner={mine ? undefined : { id: b.userId, name: ownerName(b) }} onClose={() => setEditing(false)} />
    </>
  );
}
