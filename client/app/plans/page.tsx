"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { StatusPill } from "@/components/ui/status-pill";
import { CategoryTabs } from "@/components/ui/category-tabs";
import { PlanWizard } from "@/components/plans/plan-wizard";
import { ClientInvoiceModal } from "@/components/plans/client-invoice-modal";
import { PlanInvoiceAttachmentControl } from "@/components/plans/plan-invoice-attachment";
import { PlusIcon, AssetIcon, HeartIcon, EyeIcon, SearchIcon, CloseIcon, CheckCircleIcon, EditIcon, DownloadIcon } from "@/components/icons";
import { TextField } from "@/components/ui/form-field";
import { useAuth } from "@/lib/auth-context";
import { plans as plansApi, ApiError, hasAccess, type Plan } from "@/lib/api-client";
import { money, count, initialsOf, roleLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Plans — pitch decks built from Inventory's pages. Used to be a second tab
 * inside /inventory; split into its own nav tab (newTask.md, 9 Sep: "plan
 * will be in separate nav tab"). Same Admin/Plan-Maker-only gating as
 * before, now enforced at the nav level too (sidebar.tsx/more-sheet.tsx),
 * with this page's own fallback for anyone who lands here directly by URL.
 */
export default function PlansPage() {
  return (
    <RequireAuth>
      {/* useSearchParams() requires a Suspense boundary for static export */}
      <Suspense fallback={null}>
        <PlansContent />
      </Suspense>
    </RequireAuth>
  );
}

function PlansContent() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const token = accessToken!;
  // "Admin" in the loose sense of "acts on any plan" — a plain ADMIN by
  // default, or (15 Sep) any other role explicitly granted plans.manage.
  const isAdmin = hasAccess(user, "plans.manage");
  const canManagePlans = isAdmin || user?.role === "PLAN_MAKER";

  const [editingPlan, setEditingPlan] = useState<Plan | "new" | null>(null);
  const [pendingPlanAssetIds, setPendingPlanAssetIds] = useState<string[]>([]);

  // Inventory's "Create plan" (from a Pages selection) lands here via
  // ?assetIds=id1,id2 — a route param survives the navigation, whereas the
  // old same-page tab switch just kept it in memory. Consumed once, then
  // stripped from the URL so a refresh/back-nav doesn't reopen the modal
  // with a stale selection.
  useEffect(() => {
    const raw = searchParams.get("assetIds");
    if (!raw) return;
    setPendingPlanAssetIds(raw.split(",").filter(Boolean));
    setEditingPlan("new");
    router.replace("/plans");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ?id=<plan> — the admin home / approvals "Review" links land here and
  // should open that plan straight away, not the unfiltered list.
  const focusId = searchParams.get("id");
  const focusQuery = useQuery({ queryKey: ["plan", focusId], queryFn: () => plansApi.get(token, focusId!), enabled: Boolean(focusId) && canManagePlans });
  useEffect(() => {
    if (!focusQuery.data) return;
    setEditingPlan(focusQuery.data);
    router.replace("/plans");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusQuery.data]);

  function openNewPlan() {
    setPendingPlanAssetIds([]);
    setEditingPlan("new");
  }

  return (
    <AppShell
      active="plans"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search plans…"
      topbarActions={
        canManagePlans ? (
          <Button size="default" onClick={openNewPlan}>
            <PlusIcon className="h-[15px] w-[15px] text-accent-ink" />
            New plan
          </Button>
        ) : undefined
      }
      fab={
        canManagePlans ? (
          <Button size="lg" className="h-14 rounded-full px-5 shadow-glow" onClick={openNewPlan}>
            <PlusIcon className="h-4 w-4 text-accent-ink" />
            New plan
          </Button>
        ) : undefined
      }
    >
      {editingPlan && canManagePlans ? (
        <PlanWizard
          key={editingPlan === "new" ? "new" : editingPlan.id}
          token={token}
          plan={editingPlan === "new" ? null : editingPlan}
          initialAssetIds={editingPlan === "new" ? pendingPlanAssetIds : []}
          onClose={() => setEditingPlan(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["plans"] })}
        />
      ) : (
      <div className="flex flex-col gap-5">
        <PageHeader title="Plans" subtitle="Pitch decks built from Inventory's pages, with client-facing totals and GST." />

        {!canManagePlans ? (
          <div className="rounded-lg border border-border bg-surface p-8 text-center shadow-card">
            <p className="max-w-[56ch] text-[0.875rem] text-text-muted">Plans are available to Admin and Plan Maker accounts.</p>
          </div>
        ) : (
          <PlansSection
            token={token}
            currentUserId={user?.id}
            isAdmin={isAdmin}
            editingPlan={editingPlan}
            setEditingPlan={setEditingPlan}
            initialAssetIds={pendingPlanAssetIds}
          />
        )}
      </div>
      )}
    </AppShell>
  );
}

const STATUS_TAB_LABEL: Record<Plan["status"], string> = {
  DRAFT: "Draft",
  // PENDING_APPROVAL has no tab of its own — nothing transitions into it
  // any more (user request, 11 Sep, retired the submit step), this label
  // only exists so the Record stays exhaustive for any pre-existing row.
  PENDING_APPROVAL: "Needs approval",
  APPROVED: "Active",
  REJECTED: "Rejected",
};

// "Details filled" checklist — every field a finished pitch should carry
// before it's submitted. Purely a client-side completeness hint (nothing
// here is enforced server-side); missing items are named so a half-filled
// plan says exactly what's left, not just a bare percentage.
function planCompleteness(plan: Plan) {
  const checks: { label: string; done: boolean }[] = [
    { label: "Client contact", done: Boolean(plan.clientContact) },
    { label: "Budget", done: plan.budget != null },
    { label: "Pages", done: plan.items.length > 0 },
    { label: "Rates on every page", done: plan.items.length > 0 && plan.items.every((i) => Number(i.cost) > 0) },
  ];
  const done = checks.filter((c) => c.done).length;
  return { percent: Math.round((done / checks.length) * 100), missing: checks.filter((c) => !c.done).map((c) => c.label) };
}

function PlansSection({
  token,
  currentUserId,
  isAdmin,
  editingPlan,
  setEditingPlan,
  initialAssetIds,
}: {
  token: string;
  currentUserId?: string;
  isAdmin: boolean;
  editingPlan: Plan | "new" | null;
  setEditingPlan: (v: Plan | "new" | null) => void;
  /** Pages picked on Inventory's Pages tab before "Create plan" was clicked — only meaningful for a brand-new plan. */
  initialAssetIds: string[];
}) {
  const queryClient = useQueryClient();
  const [deletingPlan, setDeletingPlan] = useState<Plan | null>(null);
  // "Generate invoice" popup (user request, 13 Sep) — see ClientInvoiceModal.
  const [invoicingPlan, setInvoicingPlan] = useState<Plan | null>(null);
  // Status filter (horizontal tab strip) + search, mirroring the pattern
  // just added to Inventory's category filter for the same reason: quickly
  // narrowing "what needs my attention right now" out of a growing list.
  const [statusFilter, setStatusFilter] = useState<"All" | Plan["status"]>("All");
  const [search, setSearch] = useState("");

  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: () => plansApi.list(token) });
  const allItems = plansQuery.data ?? [];

  const statusTabs = useMemo(() => {
    const counts = new Map<Plan["status"], number>();
    for (const p of allItems) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
    // PENDING_APPROVAL excluded — no plan can reach that status any more
    // (user request, 11 Sep). A pre-existing row in that state still shows
    // up under "All", just without its own dedicated tab.
    const order: Plan["status"][] = ["DRAFT", "APPROVED", "REJECTED"];
    return [
      { key: "All" as const, label: "All", count: allItems.length },
      ...order.map((s) => ({ key: s, label: STATUS_TAB_LABEL[s], count: counts.get(s) ?? 0 })),
    ];
  }, [allItems]);

  const items = useMemo(() => {
    let result = allItems;
    if (statusFilter !== "All") result = result.filter((p) => p.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((p) => p.name.toLowerCase().includes(q) || p.clientName.toLowerCase().includes(q));
    return result;
  }, [allItems, statusFilter, search]);

  // Google Sheet, not PDF (user request, 10 Sep — "remove secondary export
  // option only google sheet will be there ... list of plans ... option of
  // viewing googlesheet of plan for client or internal"). If the sheet's
  // already been generated, open it straight away; otherwise generate then
  // open. The blank tab opens synchronously (inside the click handler) so
  // it isn't caught by the browser's popup blocker the way a `window.open`
  // after an awaited network call would be — its location is filled in
  // once the sheet finishes generating.
  const sheetMutation = useMutation({
    mutationFn: async ({ plan, variant, tab }: { plan: Plan; variant: "client" | "internal"; tab: Window | null }) => {
      const { spreadsheetUrl } = await plansApi.generateSheet(token, plan.id, variant);
      tab?.location.assign(spreadsheetUrl);
      return spreadsheetUrl;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });
  function openSheet(plan: Plan, variant: "client" | "internal") {
    const existingUrl = variant === "client" ? plan.clientSheetUrl : plan.internalSheetUrl;
    if (existingUrl) {
      window.open(existingUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const tab = window.open("", "_blank");
    sheetMutation.mutate({ plan, variant, tab });
  }
  const deleteMutation = useMutation({
    mutationFn: (id: string) => plansApi.remove(token, id),
    onSuccess: () => {
      setDeletingPlan(null);
      queryClient.invalidateQueries({ queryKey: ["plans"] });
    },
  });
  // Approval workflow (user request, 11 Sep — "remove option of submit for
  // approval, plan maker or admin can approve plan by themselves only"):
  // approve/reject act directly on a DRAFT plan. Server enforces who can
  // call which (Admin: any plan; Plan Maker: only their own, checked below
  // via ownsPlan so the buttons don't even appear for a plan that isn't
  // theirs).
  const approveMutation = useMutation({
    mutationFn: (id: string) => plansApi.approve(token, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => plansApi.reject(token, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });
  const workflowBusy = approveMutation.isPending || rejectMutation.isPending;
  const workflowError = approveMutation.error ?? rejectMutation.error;

  return (
    <>
      {workflowError && (
        <ErrorNotice message={workflowError instanceof ApiError ? workflowError.message : "Couldn't update that plan's approval status."} />
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search — by plan name or client name. Kept compact and
            fixed-width on larger screens so the status filter strip sits
            beside it instead of stacking below (user request, 11 Sep). */}
        <div className="relative shrink-0 sm:w-56">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search plans…"
            aria-label="Search plans by name or client"
            className="h-9 w-full rounded-full border border-border bg-surface pl-8 pr-8 text-[0.8125rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-text-faint hover:bg-surface-2 hover:text-text"
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Status filter — horizontal, scrollable tab strip: which plans
            are still drafts, which need someone's approval, which are live,
            which got rejected. Same shared component as Inventory's
            category strip (client/components/ui/category-tabs.tsx). Sits
            beside the search bar on sm+ screens, wraps below it on mobile. */}
        <div className="min-w-0 flex-1">
          <CategoryTabs tabs={statusTabs} value={statusFilter} onChange={setStatusFilter} />
        </div>
      </div>

      {plansQuery.isLoading ? (
        <div className="rounded-lg border border-border bg-surface shadow-card">
          <TableSkeleton />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface shadow-card">
          <EmptyState label={allItems.length === 0 ? "No plans yet." : search ? `No plans match "${search}".` : "No plans in this status."} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((plan) => (
            <PlanCard
              key={plan.id}
              token={token}
              plan={plan}
              // Admin can act on any plan; a Plan Maker only on their own —
              // mirrors plans/service.js's assertCanAccessPlan so the
              // buttons shown here never promise an action the server
              // would reject.
              ownsPlan={isAdmin || plan.createdBy?.id === currentUserId}
              onEdit={() => setEditingPlan(plan)}
              onDelete={() => setDeletingPlan(plan)}
              onGenerateInvoice={() => setInvoicingPlan(plan)}
              onApprove={() => approveMutation.mutate(plan.id)}
              onReject={() => rejectMutation.mutate(plan.id)}
              workflowBusy={workflowBusy}
              onOpenSheet={(variant) => openSheet(plan, variant)}
              sheetPending={sheetMutation.isPending}
              sheetError={sheetMutation.isError ? sheetMutation.error : null}
              onExecutionSheetSaved={() => queryClient.invalidateQueries({ queryKey: ["plans"] })}
            />
          ))}
        </div>
      )}




      {invoicingPlan && <ClientInvoiceModal token={token} plan={invoicingPlan} onClose={() => setInvoicingPlan(null)} />}

      {deletingPlan && (
        <Sheet onClose={() => setDeletingPlan(null)} panelClassName="md:max-w-[420px]">
          <div className="flex flex-col gap-5 overflow-y-auto p-6 pt-1">
            <h2 className="text-lg font-semibold">Delete plan</h2>
            <p className="text-[0.8125rem] text-text-muted">
              This permanently removes <strong className="text-text">{deletingPlan.name}</strong>. This can&apos;t be undone.
            </p>
            {deleteMutation.isError && (
              <ErrorNotice message={deleteMutation.error instanceof ApiError ? deleteMutation.error.message : "Couldn't delete this plan."} />
            )}
            <div className="flex gap-2.5">
              <Button variant="ghost" className="flex-1" onClick={() => setDeletingPlan(null)}>
                Cancel
              </Button>
              <Button variant="danger" className="flex-1" onClick={() => deleteMutation.mutate(deletingPlan.id)} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? "Deleting…" : "Delete plan"}
              </Button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}

// Card anatomy (top → bottom): identity header (icon tile + name, status
// pill + Edit/Delete icons top-right) → readiness → engagement stat cells →
// cost footer band → actions (approve/reject, sheets, execution sheet).
// Same surface/border/shadow tokens as every other card in the app (KPI
// cards, Inventory page cards); the only card-level affordance is a
// border/glow response on hover — no lift, since the card itself isn't
// clickable, only its buttons/links.
//
// Extracted to its own component (was inline in the .map above) so the
// execution-sheet input below can hold its own local state per card — user
// request, 11 Sep: "execution sheet attachment option will [be] on plan
// card, put edit, cross as icons on top right corner of each plan".
function PlanCard({
  token,
  plan,
  ownsPlan,
  onEdit,
  onDelete,
  onGenerateInvoice,
  onApprove,
  onReject,
  workflowBusy,
  onOpenSheet,
  sheetPending,
  sheetError,
  onExecutionSheetSaved,
}: {
  token: string;
  plan: Plan;
  ownsPlan: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onGenerateInvoice: () => void;
  onApprove: () => void;
  onReject: () => void;
  workflowBusy: boolean;
  onOpenSheet: (variant: "client" | "internal") => void;
  sheetPending: boolean;
  sheetError: unknown;
  onExecutionSheetSaved: () => void;
}) {
  const completeness = planCompleteness(plan);
  const [executionSheetUrl, setExecutionSheetUrl] = useState(plan.executionSheetUrl ?? "");
  // Two-step attach (user request, 11 Sep — "on clicking option of pasting
  // link"): the card shows a plain "Attach" prompt by default; only clicking
  // it (or "Change" once one's already attached) reveals the link input,
  // rather than every card always showing an open text field.
  const [editingSheet, setEditingSheet] = useState(false);
  // Re-download of an already-generated client invoice (the popup is for
  // generating/reissuing; this is the quick path once the number exists).
  const downloadInvoiceMutation = useMutation({
    mutationFn: () => plansApi.downloadClientInvoicePdf(token, plan.id, plan.clientInvoiceNumber),
  });
  const saveExecutionSheetMutation = useMutation({
    mutationFn: () => plansApi.update(token, plan.id, { executionSheetUrl: executionSheetUrl.trim() ? executionSheetUrl.trim() : null }),
    onSuccess: () => {
      setEditingSheet(false);
      onExecutionSheetSaved();
    },
  });

  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-card transition-[border-color,box-shadow] duration-200 hover:border-border-strong hover:shadow-accent-glow">
      <div className="flex flex-col gap-4 p-5">
        {/* Identity — icon tile (same tile treatment as KpiCard) + client
            eyebrow + plan name; status pill + Edit/Delete icons top-right
            (user request, 11 Sep — replaces the old full-width Edit/Delete
            buttons that used to sit at the card's bottom). */}
        <div className="flex items-start gap-3">
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-surface-2 ring-1 ring-inset ring-border-strong transition-colors group-hover:bg-accent-soft">
            <AssetIcon className="h-4 w-4 text-text-muted transition-colors group-hover:text-text" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">{plan.clientName}</p>
            <p className="mt-0.5 line-clamp-2 text-[0.9375rem] font-semibold leading-snug">{plan.name}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* DRAFT/APPROVED/REJECTED are valid pill statuses as-is;
                PENDING_APPROVAL borrows SCHEDULED's "awaiting" look. */}
            <StatusPill status={plan.status === "PENDING_APPROVAL" ? "SCHEDULED" : plan.status} />
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${plan.name}`}
              className="flex h-6 w-6 items-center justify-center rounded-full text-text-faint hover:bg-surface-2 hover:text-text"
            >
              <EditIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete ${plan.name}`}
              className="flex h-6 w-6 items-center justify-center rounded-full text-text-faint hover:bg-rose-soft hover:text-rose"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Set on approval — the real Campaign its pages now run under
            (user request, 10 Sep — "on his marking all pages mentioned in
            the plan will get the campaign visible"). */}
        {plan.campaignId && (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/campaigns/view?id=${plan.campaignId}`}
              className="inline-flex w-fit items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[0.6875rem] font-semibold text-accent transition-colors hover:bg-accent-2-soft hover:text-text"
            >
              View campaign ↗
            </Link>
            {/* user request, 13 Sep — "on clicking generate invoice, it'll
                ask for client details like gst, company address, phone
                number ... in separate ui popup": the Taggify → client
                invoice for this plan's client-facing total. Only once
                approved (same gate as the campaign, and the server's
                PLAN_NOT_APPROVED). Everyone who can see this page (Admin /
                Plan Maker) can generate for the plans they can act on. */}
            {ownsPlan && (
              <button
                type="button"
                onClick={onGenerateInvoice}
                className="inline-flex w-fit items-center gap-1 rounded-full border border-accent/40 px-2.5 py-1 text-[0.6875rem] font-semibold text-accent transition-colors hover:bg-accent-soft"
              >
                {plan.clientInvoiceNumber ? "Regenerate invoice" : "Generate invoice"}
              </button>
            )}
            {plan.clientInvoiceNumber && (
              <button
                type="button"
                onClick={() => downloadInvoiceMutation.mutate()}
                disabled={downloadInvoiceMutation.isPending}
                title={`Download ${plan.clientInvoiceNumber}`}
                aria-label={`Download invoice ${plan.clientInvoiceNumber}`}
                className="inline-flex w-fit items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[0.6875rem] font-semibold text-text-muted transition-colors hover:bg-border hover:text-text disabled:opacity-50"
              >
                <DownloadIcon className="h-3 w-3" />
                {plan.clientInvoiceNumber}
              </button>
            )}
          </div>
        )}
        {downloadInvoiceMutation.isError && (
          <ErrorNotice message={downloadInvoiceMutation.error instanceof ApiError ? downloadInvoiceMutation.error.message : "Couldn't download the invoice."} />
        )}

        {/* user request, 14 Sep — "there'll be option of attaching invoice
            document in pdf format as well": a PDF kept on the plan next to
            the generated client invoice. Not gated on approval (unlike
            Generate invoice) — an invoice raised outside the system can
            exist before the plan is approved. Same ownsPlan gate as every
            other write on the card. */}
        {ownsPlan && <PlanInvoiceAttachmentControl token={token} plan={plan} />}

        {/* "What's left" — a quick read on how filled-in this pitch is
            before it's submitted, and exactly which fields are still
            missing (not just a bare percentage). Only worth a full
            progress row once something's actually missing; a finished
            plan gets a quiet one-line confirmation instead. */}
        {completeness.percent < 100 ? (
          <div className="flex flex-col gap-1.5 rounded-md bg-surface-2 px-3 py-2.5 ring-1 ring-inset ring-border">
            <div className="flex items-center justify-between text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">
              <span>Details filled</span>
              <span className="tabular-nums text-text">{completeness.percent}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${completeness.percent}%` }} />
            </div>
            <p className="text-[0.6875rem] text-text-faint">Missing: {completeness.missing.join(", ")}</p>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 rounded-md bg-accent-soft px-3 py-2 text-[0.6875rem] font-semibold text-accent">
            <CheckCircleIcon className="h-3.5 w-3.5" /> All details filled
          </p>
        )}

        {/* Expected engagement — same stat-cell treatment as the Inventory
            page card's "Performance metrics" row. */}
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col items-center gap-0.5 rounded-md bg-surface-2 px-2 py-2 ring-1 ring-inset ring-border">
            <span className="text-[0.9375rem] font-semibold tabular-nums">{count(plan.expectedEngagement.likes)}</span>
            <span className="flex items-center gap-1 text-[0.6875rem] text-text-faint">
              <HeartIcon className="h-3 w-3" /> Likes
            </span>
          </div>
          <div className="flex flex-col items-center gap-0.5 rounded-md bg-surface-2 px-2 py-2 ring-1 ring-inset ring-border">
            <span className="text-[0.9375rem] font-semibold tabular-nums">{count(plan.expectedEngagement.views)}</span>
            <span className="flex items-center gap-1 text-[0.6875rem] text-text-faint">
              <EyeIcon className="h-3 w-3" /> Views
            </span>
          </div>
          <div className="flex flex-col items-center gap-0.5 rounded-md bg-surface-2 px-2 py-2 ring-1 ring-inset ring-border">
            <span className="text-[0.9375rem] font-semibold tabular-nums">{plan.items.length}</span>
            <span className="text-[0.6875rem] text-text-faint">{plan.items.length === 1 ? "Page" : "Pages"}</span>
          </div>
        </div>
      </div>

      {/* Cost band — the number a reader scans for first, so it gets the
          display size instead of a same-weight table row. Budget variance
          sits beside it, colored by direction. */}
      <div className="mt-auto flex items-end justify-between gap-3 border-t border-border bg-surface-2 px-5 py-3.5">
        <div>
          <p className="text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">Total cost</p>
          <p className="text-[1.25rem] font-semibold tracking-tight tabular-nums">{money(plan.totalCost)}</p>
        </div>
        {plan.budgetVariance != null && (
          <div className="text-right">
            <p className="text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">Budget</p>
            <p className={cn("text-[0.8125rem] font-semibold tabular-nums", plan.budgetVariance < 0 ? "text-rose" : "text-accent")}>
              {plan.budgetVariance < 0 ? `${money(Math.abs(plan.budgetVariance))} over` : `${money(plan.budgetVariance)} under`}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border p-4">
        {/* Approve/reject (user request, 11 Sep — no submit step; whoever
            built it decides directly) — only ever shown to someone the
            server would actually let act: Admin on anything, a Plan Maker
            only on their own plan. */}
        {ownsPlan && plan.status === "DRAFT" && (
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={onApprove} disabled={workflowBusy}>
              Approve
            </Button>
            <Button size="sm" variant="danger" className="flex-1" onClick={onReject} disabled={workflowBusy}>
              Reject
            </Button>
          </div>
        )}

        <div className="flex gap-2">
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => onOpenSheet("client")} disabled={sheetPending}>
            {plan.clientSheetUrl ? "Client sheet ↗" : "Client sheet"}
          </Button>
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => onOpenSheet("internal")} disabled={sheetPending}>
            {plan.internalSheetUrl ? "Internal sheet ↗" : "Internal sheet"}
          </Button>
        </div>
        {sheetError instanceof Error && (
          <ErrorNotice message={sheetError instanceof ApiError ? sheetError.message : "Couldn't generate the sheet."} />
        )}

        {/* Execution sheet attach (user request, 11 Sep — "execution sheet
            attachment option will [be] on plan card ... of 2 steps, on card
            showing attach execution sheet, on clicking option of pasting
            link"): a plain prompt by default; clicking it reveals the link
            input as a second step. Attached vs. not-attached read as two
            visibly different states — a muted dashed prompt vs. a solid
            accent-tinted confirmation — not just differently-filled copies
            of the same box. */}
        <div className="border-t border-border pt-2.5">
          {editingSheet ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">Execution sheet link</p>
              <div className="flex gap-1.5">
                <div className="flex-1">
                  <TextField
                    type="url"
                    aria-label={`${plan.name} execution sheet link`}
                    value={executionSheetUrl}
                    onChange={setExecutionSheetUrl}
                    placeholder="https://docs.google.com/spreadsheets/…"
                  />
                </div>
                <Button size="sm" onClick={() => saveExecutionSheetMutation.mutate()} disabled={saveExecutionSheetMutation.isPending}>
                  {saveExecutionSheetMutation.isPending ? "Saving…" : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setExecutionSheetUrl(plan.executionSheetUrl ?? "");
                    setEditingSheet(false);
                  }}
                  disabled={saveExecutionSheetMutation.isPending}
                >
                  Cancel
                </Button>
              </div>
              {saveExecutionSheetMutation.isError && (
                <ErrorNotice
                  message={saveExecutionSheetMutation.error instanceof ApiError ? saveExecutionSheetMutation.error.message : "Couldn't save that link."}
                />
              )}
            </div>
          ) : plan.executionSheetUrl ? (
            <div className="flex items-center justify-between gap-2 rounded-md bg-accent-soft px-3 py-2">
              <a
                href={plan.executionSheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 items-center gap-1.5 text-[0.75rem] font-semibold text-blue hover:text-text"
              >
                <CheckCircleIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Execution sheet attached — Open ↗</span>
              </a>
              <button type="button" onClick={() => setEditingSheet(true)} className="shrink-0 text-[0.75rem] font-semibold text-text-faint hover:text-text">
                Change
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingSheet(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong px-3 py-2 text-[0.75rem] font-semibold text-text-faint hover:border-accent hover:text-text"
            >
              <PlusIcon className="h-3 w-3" />
              Attach execution sheet
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
