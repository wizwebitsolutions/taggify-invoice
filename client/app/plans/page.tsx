"use client";

import { OwnSectionGate } from "@/components/auth/own-section-gate";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Note } from "@/components/ui/note";
import { Sheet } from "@/components/ui/sheet";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { StatusPill } from "@/components/ui/status-pill";
import { CategoryTabs } from "@/components/ui/category-tabs";
import { PlanWizard } from "@/components/plans/plan-wizard";
import { ClientInvoiceModal } from "@/components/plans/client-invoice-modal";
import { ExecutionSheetModal } from "@/components/plans/execution-sheet-modal";
import { PlanInvoiceAttachmentControl } from "@/components/plans/plan-invoice-attachment";
import { PlusIcon, AssetIcon, HeartIcon, EyeIcon, SearchIcon, CloseIcon, CheckCircleIcon, EditIcon, DownloadIcon, UploadIcon, RefreshIcon } from "@/components/icons";
import { UploadPlanModal } from "@/components/plans/upload-plan-modal";
import { GoogleAwareError } from "@/components/integrations/google-reconnect-notice";
import { CompletePlanSteps } from "@/components/plans/complete-plan-steps";
import { parsePlanSheet } from "@/lib/parseAssignmentSheet";
import { planMissing } from "@/lib/plan-missing";
import { useAuth } from "@/lib/auth-context";
import { plans as plansApi, ApiError, hasAccess, type Plan, type SheetFormat, canUse } from "@/lib/api-client";
import { SheetFormatModal, sheetFormatOf } from "@/components/plans/sheet-format";
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
      <OwnSectionGate ownKey="plans.view" active="plans">
      {/* useSearchParams() requires a Suspense boundary for static export */}
      <Suspense fallback={null}>
        <PlansContent />
      </Suspense>
      </OwnSectionGate>
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
  // isAdmin: acts on any plan (edit or approve) — mirrors
  // plans/service.js's assertCanAccessPlan, which the server checks per
  // route (plans.edit for edit/delete/invoice, plans.approve for
  // approve/reject); the UI treats "can act on any plan" as one flag since
  // both are ADMIN-only baselines today.
  const isAdmin = hasAccess(user, "plans.edit") || hasAccess(user, "plans.approve");
  const canManagePlans = isAdmin || (user?.role === "PLAN_MAKER" && canUse(user, "plans.edit"));

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
  // "Upload plan" (user request, 22 Sep) — a plan built from the user's own
  // Google Sheet instead of the wizard; see UploadPlanModal. Once created,
  // the missing-details steps open for it straight away.
  const [uploading, setUploading] = useState(false);
  const [completingPlanId, setCompletingPlanId] = useState<string | null>(null);

  return (
    <AppShell
      active="plans"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search plans…"
      topbarActions={
        canManagePlans ? (
          <div className="flex items-center gap-2">
            <Button size="default" variant="secondary" onClick={() => setUploading(true)}>
              <UploadIcon className="h-[15px] w-[15px]" />
              Upload plan
            </Button>
            <Button size="default" onClick={openNewPlan}>
              <PlusIcon className="h-[15px] w-[15px] text-accent-ink" />
              New plan
            </Button>
          </div>
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
            completingPlanId={completingPlanId}
            setCompletingPlanId={setCompletingPlanId}
            onUploadPlan={() => setUploading(true)}
          />
        )}
      </div>
      )}
      {uploading && canManagePlans && (
        <UploadPlanModal
          token={token}
          onClose={() => setUploading(false)}
          onCreated={(plan) => {
            setUploading(false);
            queryClient.setQueryData<Plan[]>(["plans"], (prev) => [plan, ...(prev ?? []).filter((p) => p.id !== plan.id)]);
            queryClient.invalidateQueries({ queryKey: ["plans"] });
            if (planMissing(plan).steps.length > 0) setCompletingPlanId(plan.id);
          }}
        />
      )}
    </AppShell>
  );
}

type PlanSort = "newest" | "budget-desc" | "budget-asc";

const ALL_MAKERS = "all";

/** A plan's maker, keyed by id; plans with no recorded maker share one "unknown" bucket. */
const makerKey = (p: Plan) => p.createdBy?.id ?? "unknown";

interface PlanMaker {
  id: string;
  name: string;
  total: number;
  drafts: number;
  approved: number;
  lastUpdated: string;
}

function groupByMaker(plans: Plan[]): PlanMaker[] {
  const byId = new Map<string, PlanMaker>();
  for (const p of plans) {
    const id = makerKey(p);
    const m = byId.get(id) ?? { id, name: p.createdBy?.name?.trim() || "Unknown", total: 0, drafts: 0, approved: 0, lastUpdated: p.updatedAt };
    m.total += 1;
    if (p.status === "DRAFT") m.drafts += 1;
    if (p.status === "APPROVED") m.approved += 1;
    if (p.updatedAt > m.lastUpdated) m.lastUpdated = p.updatedAt;
    byId.set(id, m);
  }
  return [...byId.values()].sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
}

function PlanMakerList({ makers, totalPlans, loading, onOpen }: { makers: PlanMaker[]; totalPlans: number; loading: boolean; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const visible = makers.filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()));
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-surface shadow-card">
        <TableSkeleton />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="plan-maker-list">
      {makers.length > 0 && (
        <div className="relative sm:w-64">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search plan makers…"
            aria-label="Search plan makers"
            className="h-9 w-full rounded-full border border-border bg-surface pl-8 pr-3 text-[0.8125rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30"
          />
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        {visible.length === 0 ? (
          <EmptyState label={makers.length === 0 ? "No plans yet." : `No plan makers match "${query}".`} />
        ) : (
          <ul className="divide-y divide-border">
            {!query.trim() && (
              <li>
                <button type="button" onClick={() => onOpen(ALL_MAKERS)} className="flex w-full items-center gap-3 bg-surface-2/40 px-4 py-3.5 text-left hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9375rem] font-semibold">All plans</span>
                    <span className="block text-[0.75rem] text-text-muted">
                      {totalPlans} plan{totalPlans === 1 ? "" : "s"} across {makers.length} plan maker{makers.length === 1 ? "" : "s"} — search by POC, sort by budget
                    </span>
                  </span>
                  <span aria-hidden className="text-text-faint">→</span>
                </button>
              </li>
            )}
            {visible.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => onOpen(m.id)} aria-label={`Open ${m.name}'s plans`} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[0.75rem] font-semibold">{initialsOf(m.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-semibold">{m.name}</span>
                    <span className="block text-[0.75rem] text-text-muted">
                      {m.total} plan{m.total === 1 ? "" : "s"} · {m.drafts} draft · {m.approved} approved
                    </span>
                  </span>
                  <span className="hidden text-[0.72rem] text-text-faint sm:block">Updated {new Date(m.lastUpdated).toLocaleDateString("en-IN", { dateStyle: "medium" })}</span>
                  <span aria-hidden className="text-text-faint">→</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
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
// plan says exactly what's left, not just a bare percentage. Shared with
// the "Complete details" steps popup — lib/plan-missing.ts.
const planCompleteness = (plan: Plan) => {
  const m = planMissing(plan);
  return { percent: m.percent, missing: m.labels, steps: m.steps };
};

function PlansSection({
  token,
  currentUserId,
  isAdmin,
  editingPlan,
  setEditingPlan,
  initialAssetIds,
  completingPlanId,
  setCompletingPlanId,
  onUploadPlan,
}: {
  token: string;
  currentUserId?: string;
  isAdmin: boolean;
  editingPlan: Plan | "new" | null;
  setEditingPlan: (v: Plan | "new" | null) => void;
  /** Pages picked on Inventory's Pages tab before "Create plan" was clicked — only meaningful for a brand-new plan. */
  initialAssetIds: string[];
  /** The plan whose "Complete details" steps are open (user request, 22 Sep) — held by id so every save re-renders the steps with the fresh plan. */
  completingPlanId: string | null;
  setCompletingPlanId: (id: string | null) => void;
  onUploadPlan: () => void;
}) {
  // Plan Maker own-content switches (24 Sep) decide which actions show.
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [deletingPlan, setDeletingPlan] = useState<Plan | null>(null);
  // "Generate invoice" popup (user request, 13 Sep) — see ClientInvoiceModal.
  const [invoicingPlan, setInvoicingPlan] = useState<Plan | null>(null);
  // Status filter (horizontal tab strip) + search, mirroring the pattern
  // just added to Inventory's category filter for the same reason: quickly
  // narrowing "what needs my attention right now" out of a growing list.
  const [statusFilter, setStatusFilter] = useState<"All" | Plan["status"]>("All");
  const [search, setSearch] = useState("");
  // POC is matched by the search box (plan maker's name); budget is a sort,
  // not a filter (user request, 23 Sep).
  const [sortBy, setSortBy] = useState<PlanSort>("newest");

  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: () => plansApi.list(token) });
  const everyPlan = plansQuery.data ?? [];
  // Admin sees plans grouped by who made them (user request, 23 Sep — "plans
  // should show as a list of plan makers, on selecting it opens plans of the
  // specific plan maker, to admin only"). A Plan Maker only ever gets their
  // own plans from the server, so they skip straight to the plan grid.
  // Held in the URL (?maker=<id> or ?maker=all) so Back / refresh keep the
  // admin where they were.
  const router = useRouter();
  const searchParams = useSearchParams();
  const makerId = searchParams.get("maker");
  function setMakerId(id: string | null) {
    router.replace(id ? `/plans?maker=${encodeURIComponent(id)}` : "/plans", { scroll: false });
  }
  const makers = useMemo(() => groupByMaker(everyPlan), [everyPlan]);
  const showMakerList = isAdmin && makerId == null;
  const makerTitle = makerId === ALL_MAKERS ? "All plans" : makers.find((m) => m.id === makerId)?.name ?? "—";
  const allItems = useMemo(
    () => (isAdmin && makerId && makerId !== ALL_MAKERS ? everyPlan.filter((p) => makerKey(p) === makerId) : everyPlan),
    [everyPlan, isAdmin, makerId]
  );

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
    if (q) result = result.filter((p) => p.name.toLowerCase().includes(q) || p.clientName.toLowerCase().includes(q) || (p.createdBy?.name ?? "").toLowerCase().includes(q));
    if (sortBy !== "newest") {
      // Plans with no budget sort last either way.
      const b = (p: Plan) => (p.budget != null ? Number(p.budget) : null);
      result = [...result].sort((x, y) => {
        const bx = b(x);
        const by = b(y);
        if (bx == null || by == null) return bx == null ? (by == null ? 0 : 1) : -1;
        return sortBy === "budget-desc" ? by - bx : bx - by;
      });
    }
    return result;
  }, [allItems, statusFilter, search, sortBy]);

  // Google Sheet, not PDF (user request, 10 Sep — "remove secondary export
  // option only google sheet will be there ... list of plans ... option of
  // viewing googlesheet of plan for client or internal"). If the sheet's
  // already been generated, open it straight away; otherwise generate then
  // open. The blank tab opens synchronously (inside the click handler) so
  // it isn't caught by the browser's popup blocker the way a `window.open`
  // after an awaited network call would be — its location is filled in
  // once the sheet finishes generating.
  const sheetMutation = useMutation({
    mutationFn: async ({ plan, variant, tab, sheetFormat }: { plan: Plan; variant: "client" | "internal"; tab: Window | null; sheetFormat?: SheetFormat }) => {
      const result = await plansApi.generateSheet(token, plan.id, variant, sheetFormat);
      tab?.location.assign(result.spreadsheetUrl);
      return result;
    },
    onSuccess: () => {
      setSheetPicker(null);
      queryClient.invalidateQueries({ queryKey: ["plans"] });
    },
  });
  // "Client sheet" (16 Oct) first asks which of the two formats to use — the
  // popup below; confirming generates (or regenerates) in that format and opens
  // it. An already-generated sheet in the same format is offered to open as is.
  const [sheetPicker, setSheetPicker] = useState<Plan | null>(null);
  // The internal sheet has no popup: an existing link opens straight away — the
  // server keeps it current by rewriting the sheet after every plan edit (29 Sep).
  function openSheet(plan: Plan, variant: "client" | "internal") {
    if (variant === "client") {
      setSheetPicker(plan);
      return;
    }
    if (plan.internalSheetUrl) {
      window.open(plan.internalSheetUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const tab = window.open("", "_blank");
    sheetMutation.mutate({ plan, variant, tab });
  }
  function confirmClientSheet(plan: Plan, sheetFormat: SheetFormat) {
    if (plan.clientSheetUrl && sheetFormat === sheetFormatOf(plan)) {
      window.open(plan.clientSheetUrl, "_blank", "noopener,noreferrer");
      setSheetPicker(null);
      return;
    }
    // The blank tab opens synchronously (inside the click) so the popup blocker lets it through.
    const tab = window.open("", "_blank");
    sheetMutation.mutate({ plan, variant: "client", tab, sheetFormat });
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
  // Refresh for an uploaded plan (user request, 22 Sep — "refresh button of
  // fetching updated sheet"): re-fetch the SAME stored link, re-parse, and
  // sync. Nothing is re-attached; the server keeps in-app values for cells
  // the sheet leaves blank.
  const refreshMutation = useMutation({
    mutationFn: async (plan: Plan) => {
      const { tabs } = await plansApi.importSheetTabs(token, plan.sourceSheetUrl!);
      const parsed = await parsePlanSheet(tabs.map((t) => t.csv));
      return plansApi.syncFromSheet(token, plan.id, { fields: parsed.fields, rows: parsed.rows });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });
  // Execution sheet → links (23 Sep). The server reads the sheet when the
  // link is saved on an approved plan and on "Refresh links"; what it found
  // is persisted on the plan (executionSheetFetchedAt / executionSheetPending),
  // while this one-shot notice (how many attached / the read error) is per
  // card, for the click that just happened.
  const [execSheetNotice, setExecSheetNotice] = useState<Record<string, { summary?: { attached: number; alreadyLinked: number; pending: number }; error?: string }>>({});
  const syncExecutionMutation = useMutation({
    mutationFn: (plan: Plan) => plansApi.syncExecutionSheet(token, plan.id),
    onSuccess: ({ summary }, plan) => {
      setExecSheetNotice((n) => ({ ...n, [plan.id]: { summary } }));
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      queryClient.invalidateQueries({ queryKey: ["links"] });
    },
    onError: (err, plan) => setExecSheetNotice((n) => ({ ...n, [plan.id]: { error: err instanceof ApiError ? err.message : "Couldn't read the execution sheet." } })),
  });
  const completingPlan = completingPlanId ? allItems.find((p) => p.id === completingPlanId) ?? null : null;

  return (
    <>
      {workflowError && (
        <ErrorNotice message={workflowError instanceof ApiError ? workflowError.message : "Couldn't update that plan's approval status."} />
      )}

      {showMakerList ? (
        <PlanMakerList makers={makers} totalPlans={everyPlan.length} loading={plansQuery.isLoading} onOpen={setMakerId} />
      ) : (
      <>
      {isAdmin && (
        <div className="flex items-center gap-2 text-[0.8125rem]" data-testid="plan-maker-header">
          <button
            type="button"
            onClick={() => {
              setMakerId(null);
              setSearch("");
              setStatusFilter("All");
            }}
            className="font-semibold text-text-muted hover:text-text"
          >
            ← All plan makers
          </button>
          <span className="text-text-faint">/</span>
          <span className="font-semibold">{makerTitle}</span>
        </div>
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
            placeholder="Search plan, client or POC…"
            aria-label="Search plans by name, client or plan maker"
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
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as PlanSort)}
          aria-label="Sort plans"
          className="h-9 shrink-0 rounded-full border border-border bg-surface px-3.5 text-[0.8125rem] text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30"
        >
          <option value="newest">Newest first</option>
          <option value="budget-desc">Budget: high to low</option>
          <option value="budget-asc">Budget: low to high</option>
        </select>
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
              // …and, for a Plan Maker, only while the admin hasn't switched Plans → Edit / Approve off (24 Sep).
              ownsPlan={isAdmin || (plan.createdBy?.id === currentUserId && canUse(user, "plans.edit"))}
              canDecide={isAdmin || (plan.createdBy?.id === currentUserId && canUse(user, "plans.approve"))}
              onEdit={() => setEditingPlan(plan)}
              onDelete={() => setDeletingPlan(plan)}
              onGenerateInvoice={() => setInvoicingPlan(plan)}
              onApprove={() => approveMutation.mutate(plan.id)}
              onReject={() => rejectMutation.mutate(plan.id)}
              workflowBusy={workflowBusy}
              onOpenSheet={(variant) => openSheet(plan, variant)}
              sheetPending={sheetMutation.isPending}
              // Only on the card that was clicked — the mutation is shared across cards.
              sheetError={sheetMutation.isError && sheetMutation.variables?.plan.id === plan.id && sheetPicker?.id !== plan.id ? sheetMutation.error : null}
              sheetShare={sheetMutation.isSuccess && sheetMutation.variables?.plan.id === plan.id ? sheetMutation.data : null}
              onExecutionSheetSaved={(updated) => {
                setExecSheetNotice((n) => ({ ...n, [plan.id]: updated.executionSheetSyncError ? { error: updated.executionSheetSyncError } : {} }));
                queryClient.invalidateQueries({ queryKey: ["plans"] });
                queryClient.invalidateQueries({ queryKey: ["links"] });
              }}
              onSyncExecutionSheet={() => syncExecutionMutation.mutate(plan)}
              syncExecutionPending={syncExecutionMutation.isPending && syncExecutionMutation.variables?.id === plan.id}
              execSheetNotice={execSheetNotice[plan.id]}
              onRefreshSheet={() => refreshMutation.mutate(plan)}
              refreshPending={refreshMutation.isPending && refreshMutation.variables?.id === plan.id}
              refreshError={refreshMutation.isError && refreshMutation.variables?.id === plan.id ? refreshMutation.error : null}
              onCompleteDetails={() => setCompletingPlanId(plan.id)}
            />
          ))}
        </div>
      )}
      </>
      )}
      {everyPlan.length === 0 && !plansQuery.isLoading && (
        <p className="text-center text-[0.8125rem] text-text-muted">
          Have a plan in a Google Sheet already?{" "}
          <button type="button" onClick={onUploadPlan} className="font-semibold text-accent hover:underline">
            Upload plan
          </button>
        </p>
      )}
      {completingPlan && <CompletePlanSteps key={completingPlan.id} token={token} plan={completingPlan} onClose={() => setCompletingPlanId(null)} />}
      {sheetPicker && (
        <SheetFormatModal
          key={sheetPicker.id}
          planName={sheetPicker.pitchGroupId ? `${sheetPicker.name} · ${sheetPicker.variantLabel}` : sheetPicker.name}
          value={sheetFormatOf(sheetPicker)}
          existingUrl={sheetPicker.clientSheetUrl}
          pending={sheetMutation.isPending && sheetMutation.variables?.plan.id === sheetPicker.id}
          error={sheetMutation.isError && sheetMutation.variables?.plan.id === sheetPicker.id ? <GoogleAwareError error={sheetMutation.error} fallback="Couldn't generate the sheet." /> : null}
          onClose={() => !sheetMutation.isPending && setSheetPicker(null)}
          onConfirm={(f) => confirmClientSheet(sheetPicker, f)}
        />
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
  canDecide,
  onEdit,
  onDelete,
  onGenerateInvoice,
  onApprove,
  onReject,
  workflowBusy,
  onOpenSheet,
  sheetPending,
  sheetError,
  sheetShare,
  onExecutionSheetSaved,
  onSyncExecutionSheet,
  syncExecutionPending,
  execSheetNotice,
  onRefreshSheet,
  refreshPending,
  refreshError,
  onCompleteDetails,
}: {
  token: string;
  plan: Plan;
  ownsPlan: boolean;
  /** May approve/reject this plan (own plan + Plans → Approve on, or admin). */
  canDecide: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onGenerateInvoice: () => void;
  onApprove: () => void;
  onReject: () => void;
  workflowBusy: boolean;
  onOpenSheet: (variant: "client" | "internal") => void;
  sheetPending: boolean;
  sheetError: unknown;
  /** Who got edit access to the sheet just generated, or why they couldn't (8 Oct). */
  sheetShare: { sharedWith?: string; shareError?: string } | null;
  onExecutionSheetSaved: (updated: Plan) => void;
  onSyncExecutionSheet: () => void;
  syncExecutionPending: boolean;
  execSheetNotice?: { summary?: { attached: number; alreadyLinked: number; pending: number }; error?: string };
  onRefreshSheet: () => void;
  refreshPending: boolean;
  refreshError: unknown;
  onCompleteDetails: () => void;
}) {
  const completeness = planCompleteness(plan);
  const inactivePages = plan.inactivePages ?? [];
  // Two-step attach (user request, 11 Sep): the card shows a plain "Attach"
  // prompt; clicking it (or "Change" once one's attached) opens the popup
  // with the supported format, the template download and the link field
  // (21 Sep — see ExecutionSheetModal).
  const [editingSheet, setEditingSheet] = useState(false);
  // Re-download of an already-generated client invoice (the popup is for
  // generating/reissuing; this is the quick path once the number exists).
  const downloadInvoiceMutation = useMutation({
    mutationFn: () => plansApi.downloadClientInvoicePdf(token, plan.id, plan.clientInvoiceNumber),
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
            <p className="mt-0.5 line-clamp-2 text-[0.9375rem] font-semibold leading-snug">
              {plan.name}
              {plan.pitchGroupId && <span className="ml-1.5 text-[0.75rem] font-medium text-text-muted">· {plan.variantLabel}</span>}
            </p>
            {plan.createdBy?.name && <p className="mt-0.5 truncate text-[0.6875rem] text-text-faint">by {plan.createdBy.name}</p>}
            {/* Uploaded from the user's own sheet (22 Sep) — the badge links
                to that sheet; Refresh below re-reads it. */}
            {plan.sourceSheetUrl && (
              <a
                href={plan.sourceSheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-soft px-2 py-0.5 text-[0.6875rem] font-semibold text-blue hover:underline"
                data-testid="plan-from-sheet-badge"
              >
                From sheet ↗
              </a>
            )}
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
            {ownsPlan && completeness.steps.length > 0 && (
              <button type="button" onClick={onCompleteDetails} className="w-fit text-[0.75rem] font-semibold text-accent hover:underline">
                Complete details →
              </button>
            )}
          </div>
        ) : (
          <p className="flex items-center gap-1.5 rounded-md bg-accent-soft px-3 py-2 text-[0.6875rem] font-semibold text-accent">
            <CheckCircleIcon className="h-3.5 w-3.5" /> All details filled
          </p>
        )}

        {/* Pages switched off / rejected in Inventory since the plan was built (16 Oct). */}
        {inactivePages.length > 0 && (
          <Note tone="warn" className="text-[0.75rem]">
            <span data-testid="plan-inactive-pages">
              {inactivePages.length === 1 ? "1 page is" : `${inactivePages.length} pages are`} no longer available: {inactivePages.map((p) => `@${p.handle}${p.reason === "broken" ? " (not on Instagram)" : p.reason === "rejected" ? " (rejected)" : " (inactive)"}`).join(", ")}. Edit the plan to swap {inactivePages.length === 1 ? "it" : "them"}.
            </span>
          </Note>
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
        {/* A rejected plan can still be approved (8 Oct); only a draft can be rejected. */}
        {canDecide && (plan.status === "DRAFT" || plan.status === "REJECTED") && (
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={onApprove} disabled={workflowBusy}>
              Approve
            </Button>
            {plan.status === "DRAFT" && (
              <Button size="sm" variant="danger" className="flex-1" onClick={onReject} disabled={workflowBusy}>
                Reject
              </Button>
            )}
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
        <GoogleAwareError error={sheetError} fallback="Couldn't generate the sheet." />
        <SheetShareNote share={sheetShare} />
        {/* Refresh from the uploaded sheet (22 Sep) — only while still a
            draft (the server refuses afterwards) and only for whoever can
            act on the plan. */}
        {plan.sourceSheetUrl && ownsPlan && plan.status === "DRAFT" && (
          <div className="flex flex-col gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              onClick={onRefreshSheet}
              disabled={refreshPending}
              title={plan.sourceSheetFetchedAt ? `Last fetched ${new Date(plan.sourceSheetFetchedAt).toLocaleString("en-IN")}. Re-reads the sheet: filled cells replace the plan's values, blank cells keep what's typed here.` : undefined}
              data-testid="plan-refresh-sheet"
            >
              <RefreshIcon className={cn("h-3.5 w-3.5", refreshPending && "animate-spin")} />
              {refreshPending ? "Refreshing…" : "Refresh from sheet"}
            </Button>
            {refreshError instanceof Error && <ErrorNotice message={refreshError instanceof ApiError ? refreshError.message : "Couldn't refresh from the sheet."} />}
          </div>
        )}

        {/* Execution sheet attach (user request, 11 Sep — "execution sheet
            attachment option will [be] on plan card ... of 2 steps, on card
            showing attach execution sheet, on clicking option of pasting
            link"): a plain prompt by default; clicking it opens the
            ExecutionSheetModal popup as the second step. Attached vs. not-attached read as two
            visibly different states — a muted dashed prompt vs. a solid
            accent-tinted confirmation — not just differently-filled copies
            of the same box. */}
        <div className="border-t border-border pt-2.5">
          {editingSheet && <ExecutionSheetModal token={token} plan={plan} onClose={() => setEditingSheet(false)} onSaved={onExecutionSheetSaved} />}
          {plan.executionSheetUrl ? (
            <div className="flex flex-col gap-2">
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
              {/* Execution sheet → links (23 Sep): what the last read found,
                  and a way to read it again after the sheet is updated. */}
              <div className="flex flex-col gap-1.5 text-[0.72rem] text-text-faint" data-testid="execution-sheet-sync">
                {plan.status !== "APPROVED" ? (
                  <p>Posted links are read from this sheet once the plan is approved.</p>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p>
                      {plan.executionSheetFetchedAt
                        ? `Links read ${new Date(plan.executionSheetFetchedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}${(plan.executionSheetPending?.length ?? 0) > 0 ? ` · ${plan.executionSheetPending!.length} row${plan.executionSheetPending!.length === 1 ? "" : "s"} pending` : ""}`
                        : "Not read yet."}
                    </p>
                    <Button variant="secondary" size="sm" className="h-7 rounded-full px-2.5 text-[0.72rem]" onClick={onSyncExecutionSheet} disabled={syncExecutionPending} data-testid="plan-sync-execution-sheet">
                      <RefreshIcon className={cn("h-3 w-3", syncExecutionPending && "animate-spin")} />
                      {syncExecutionPending ? "Reading…" : "Refresh links"}
                    </Button>
                  </div>
                )}
                {execSheetNotice?.summary && (
                  <p className="text-text-muted" data-testid="execution-sheet-summary">
                    {`Attached ${execSheetNotice.summary.attached} new link${execSheetNotice.summary.attached === 1 ? "" : "s"}`}
                    {execSheetNotice.summary.alreadyLinked > 0 ? ` · ${execSheetNotice.summary.alreadyLinked} already linked` : ""}
                    {execSheetNotice.summary.pending > 0 ? ` · ${execSheetNotice.summary.pending} pending` : ""}
                  </p>
                )}
                {execSheetNotice?.error && <ErrorNotice message={execSheetNotice.error} />}
                {plan.status === "APPROVED" && (plan.executionSheetPending?.length ?? 0) > 0 && (
                  <ul className="flex flex-col gap-1 rounded-md border border-dashed border-border px-2.5 py-2" data-testid="execution-sheet-pending">
                    {plan.executionSheetPending!.slice(0, 5).map((p) => (
                      <li key={p.rowNumber} className="flex min-w-0 items-baseline gap-1.5">
                        <span className="shrink-0 font-mono text-text-faint">Row {p.rowNumber}</span>
                        <span className="truncate text-text-muted">{p.pageHandle ? `@${p.pageHandle}` : p.pageName ?? "—"}</span>
                        <span className="min-w-0 truncate">· {p.reason}</span>
                      </li>
                    ))}
                    {plan.executionSheetPending!.length > 5 && <li>+ {plan.executionSheetPending!.length - 5} more in the sheet</li>}
                  </ul>
                )}
              </div>
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

/** After a sheet is generated (8 Oct): the generator got edit access, or why not. */
function SheetShareNote({ share }: { share: { sharedWith?: string; shareError?: string } | null }) {
  if (!share) return null;
  if (share.shareError) return <Note tone="warn">{share.shareError}</Note>;
  if (share.sharedWith) return <Note tone="ok">{share.sharedWith} can edit this sheet.</Note>;
  return null;
}
