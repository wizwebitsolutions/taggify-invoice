"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField } from "@/components/ui/form-field";
import { CategoryPicker } from "@/components/ui/category-picker";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { StatusPill } from "@/components/ui/status-pill";
import { PlusIcon, InventoryIcon, AssetIcon, DownloadIcon, HeartIcon, EyeIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import {
  plans as plansApi,
  assets as assetsApi,
  LINK_FORMATS as FORMATS,
  ApiError,
  type Plan,
  type Asset,
  type PlanItemInput,
} from "@/lib/api-client";
import { money, count, initialsOf, roleLabel, compactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Inventory — the page/rate-card registry (formerly its own /assets route,
 * retired here: newTask.md, 8 Sep — "inventory tab -> all pages, listed
 * category wise ... option of create a plan, assets tab will be removed")
 * plus the Plans pitch-deck builder that already lived at this URL. Pages
 * are visible to every role (same as /assets was); Plans stays admin-only,
 * shown as a second tab only once there's something to switch to.
 */
export default function InventoryPage() {
  return (
    <RequireAuth>
      <InventoryContent />
    </RequireAuth>
  );
}

function InventoryContent() {
  const { user, accessToken } = useAuth();
  const [section, setSection] = useState<"pages" | "plans">("pages");
  const [showAddPage, setShowAddPage] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | "new" | null>(null);
  // newTask.md #13 / 8 Sep — "selection of pages, option of create a plan":
  // pages picked from the grid on the Pages tab, carried into a brand-new
  // plan's page list once "Create plan" is clicked below. Lives here, not
  // inside PagesSection, because it has to survive the switch over to the
  // Plans tab where the actual modal renders.
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  // Read once by PlanFormModal when it mounts for a brand-new plan, then
  // immediately cleared — see openNewPlan/openNewPlanFromSelection below,
  // both of which set this deliberately right before opening the modal, so
  // a stale selection from a previous visit can never silently leak into
  // an unrelated "New plan" click.
  const [pendingPlanAssetIds, setPendingPlanAssetIds] = useState<string[]>([]);
  const token = accessToken!;
  const isAdmin = user?.role === "ADMIN";
  const canAddPage = user?.role === "CREATOR";
  // Plan Maker (newTask.md, 8 Sep) joins Admin in the Plans tab — scoped to
  // their own plans server-side (see plans/service.js's listPlans), so this
  // client-side check only needs to be "can they see the tab at all."
  const canManagePlans = user?.role === "ADMIN" || user?.role === "PLAN_MAKER";

  function openNewPlan() {
    setPendingPlanAssetIds([]);
    setEditingPlan("new");
  }
  function openNewPlanFromSelection() {
    setPendingPlanAssetIds([...selectedAssetIds]);
    setSelectedAssetIds(new Set());
    setSection("plans");
    setEditingPlan("new");
  }

  // Same action, wired to whichever section is active — one topbar button
  // slot (desktop) / one FAB (mobile), same pattern every other page uses,
  // rather than each section rolling its own inline button.
  const primaryAction =
    section === "pages"
      ? canAddPage
        ? { label: "Add page", onClick: () => setShowAddPage(true) }
        : null
      : canManagePlans
        ? { label: "New plan", onClick: openNewPlan }
        : null;

  return (
    <AppShell
      active="inventory"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder={section === "plans" ? "Search plans…" : "Search pages…"}
      topbarActions={
        primaryAction ? (
          <Button size="default" onClick={primaryAction.onClick}>
            <PlusIcon className="h-[15px] w-[15px] text-accent-ink" />
            {primaryAction.label}
          </Button>
        ) : undefined
      }
      fab={
        primaryAction ? (
          <Button size="lg" className="h-14 rounded-full px-5 shadow-glow" onClick={primaryAction.onClick}>
            <PlusIcon className="h-4 w-4 text-accent-ink" />
            {primaryAction.label}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-7">
        <div>
          <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">Work</p>
          <h1 className="mb-1.5 text-[1.625rem] font-bold">Inventory</h1>
          <p className="text-[0.9375rem] text-text-muted">Pages and their rate cards — and, for admins, pitch decks built from them.</p>
        </div>

        {/* Only worth a tab switcher once there's a second tab to switch to
            — a role that can't manage Plans only ever has Pages, so they
            never see this row. */}
        {canManagePlans && (
          <div className="flex w-fit gap-1 rounded-full border border-border bg-surface p-1">
            <button
              type="button"
              onClick={() => setSection("pages")}
              className={cn(
                "rounded-full px-4 py-1.5 text-[0.8125rem] font-semibold transition-colors",
                section === "pages" ? "bg-accent-soft text-accent" : "text-text-muted hover:text-text"
              )}
            >
              Pages
            </button>
            <button
              type="button"
              onClick={() => setSection("plans")}
              className={cn(
                "rounded-full px-4 py-1.5 text-[0.8125rem] font-semibold transition-colors",
                section === "plans" ? "bg-accent-soft text-accent" : "text-text-muted hover:text-text"
              )}
            >
              Plans
            </button>
          </div>
        )}

        {section === "pages" ? (
          <PagesSection
            token={token}
            isAdmin={isAdmin}
            showForm={showAddPage}
            setShowForm={setShowAddPage}
            canSelect={canManagePlans}
            selectedAssetIds={selectedAssetIds}
            setSelectedAssetIds={setSelectedAssetIds}
            onCreatePlanFromSelection={openNewPlanFromSelection}
          />
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
    </AppShell>
  );
}

// ── Pages — the registry of Instagram pages/handles and their rate cards
// (formerly app/assets/page.tsx, unchanged apart from the category filter
// row this section adds). ──────────────────────────────────────────────

function PagesSection({
  token,
  isAdmin,
  showForm,
  setShowForm,
  canSelect,
  selectedAssetIds,
  setSelectedAssetIds,
  onCreatePlanFromSelection,
}: {
  token: string;
  isAdmin: boolean;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  /** Whether this role can build a Plan at all — a Creator/Finance/Team
   *  member has nothing to do with a selection, so they never see the
   *  checkboxes or the bar in the first place (newTask.md #13 / 8 Sep). */
  canSelect: boolean;
  selectedAssetIds: Set<string>;
  setSelectedAssetIds: (updater: (prev: Set<string>) => Set<string>) => void;
  onCreatePlanFromSelection: () => void;
}) {
  const queryClient = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState("All");

  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token) });
  const allItems = assetsQuery.data ?? [];
  const categories = useMemo(() => ["All", ...new Set(allItems.map((a) => a.category).filter((c): c is string => Boolean(c)))], [allItems]);
  const items = categoryFilter === "All" ? allItems : allItems.filter((a) => a.category === categoryFilter);

  function toggleSelected(assetId: string) {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  return (
    <>
      {/* Category tabs (newTask.md, 8 Sep — "listed category wise") — only
          worth showing once pages actually carry more than one category. */}
      {categories.length > 2 && (
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategoryFilter(c)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[0.8125rem] font-semibold transition-colors",
                categoryFilter === c ? "border-accent bg-accent-soft text-accent" : "border-border text-text-muted hover:bg-surface-2"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {assetsQuery.isLoading ? (
        <div className="rounded-lg border border-border bg-surface shadow-card">
          <TableSkeleton />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface shadow-card">
          <EmptyState label={allItems.length === 0 ? "No pages registered yet." : "No pages in this category."} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              token={token}
              editable={isAdmin}
              selectable={canSelect}
              selected={selectedAssetIds.has(asset.id)}
              onToggleSelect={() => toggleSelected(asset.id)}
            />
          ))}
        </div>
      )}

      {showForm && (
        <NewAssetModal
          token={token}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ["assets"] });
          }}
        />
      )}

      {/* newTask.md #13 / 8 Sep — "selection of pages, option of create a
          plan": a sticky bar appears the moment at least one page is
          checked, so the path from "pick pages" to "build a plan from
          them" doesn't require finding the Plans tab first. */}
      {canSelect && selectedAssetIds.size > 0 && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-surface px-5 py-3.5 shadow-glow">
          <span className="text-[0.8125rem] font-semibold">
            {selectedAssetIds.size} page{selectedAssetIds.size === 1 ? "" : "s"} selected
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedAssetIds(() => new Set())}>
              Clear
            </Button>
            <Button size="sm" onClick={onCreatePlanFromSelection}>
              <PlusIcon className="h-3.5 w-3.5 text-accent-ink" />
              Create plan
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function AssetCard({
  asset,
  token,
  editable,
  selectable,
  selected,
  onToggleSelect,
}: {
  asset: Asset;
  token: string;
  editable: boolean;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  // Seed with the standard formats plus any custom ones already on this
  // asset's rate card (WLDD's rate cards carry free-form names like
  // "VOXPOP" or "Type 4" — formats aren't a fixed enum server-side).
  const initialFormats = [...new Set([...FORMATS, ...asset.rateCards.map((rc) => rc.format)])];
  const [formats, setFormats] = useState<string[]>(initialFormats);
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialFormats.map((f) => [f, asset.rateCards.find((rc) => rc.format === f)?.amount ?? ""]))
  );
  const [newFormat, setNewFormat] = useState("");

  const saveMutation = useMutation({
    mutationFn: () =>
      assetsApi.updateRateCard(
        token,
        asset.id,
        formats.filter((f) => amounts[f]).map((f) => ({ format: f, amount: Number(amounts[f]) }))
      ),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });

  const approvalMutation = useMutation({
    mutationFn: (approvalStatus: "approved" | "rejected") => assetsApi.setApproval(token, asset.id, approvalStatus),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });

  function addCustomFormat() {
    const f = newFormat.trim();
    if (!f || formats.includes(f)) return;
    setFormats((prev) => [...prev, f]);
    setAmounts((prev) => ({ ...prev, [f]: "" }));
    setNewFormat("");
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-lg border bg-surface p-5 shadow-card transition-colors",
        selectable && selected ? "border-accent ring-1 ring-inset ring-accent/40" : "border-border"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {/* newTask.md #13 / 8 Sep — pick pages here, then "Create plan"
              on the bar below carries the selection straight into a new
              plan's page list, instead of re-picking them a second time
              inside the plan form. */}
          {selectable && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              aria-label={`Select @${asset.handle} for a plan`}
              className="h-4 w-4 shrink-0 rounded accent-[var(--accent)]"
            />
          )}
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2">
            <AssetIcon className="h-[18px] w-[18px] text-text-muted" />
          </div>
          <div>
            <p className="text-[0.9375rem] font-bold">@{asset.handle}</p>
            <p className="text-xs text-text-faint">
              {count(asset.followers)} followers
              {asset.category && <span> · {asset.category}</span>}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-bold capitalize",
            asset.approvalStatus === "approved" && "bg-accent-soft text-accent",
            asset.approvalStatus === "pending" && "bg-slate-soft text-slate",
            asset.approvalStatus === "rejected" && "bg-rose-soft text-rose"
          )}
        >
          {asset.approvalStatus}
        </span>
      </div>

      {editable && asset.approvalStatus === "pending" && (
        <div className="flex gap-2 border-t border-border pt-4">
          <Button size="sm" className="flex-1" onClick={() => approvalMutation.mutate("approved")} disabled={approvalMutation.isPending}>
            Approve page
          </Button>
          <Button variant="danger" size="sm" className="flex-1" onClick={() => approvalMutation.mutate("rejected")} disabled={approvalMutation.isPending}>
            Reject
          </Button>
        </div>
      )}
      {approvalMutation.isError && (
        <ErrorNotice message={approvalMutation.error instanceof ApiError ? approvalMutation.error.message : "Couldn't update approval status."} />
      )}

      <div className="border-t border-border pt-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-text-faint">Performance metrics</p>
        <div className="grid grid-cols-3 gap-3">
          <EngagementStat label="Avg. likes" value={asset.engagement.avgLikes} />
          <EngagementStat label="Avg. comments" value={asset.engagement.avgComments} />
          <EngagementStat label="Avg. views" value={asset.engagement.avgViews} />
        </div>
        {asset.engagement.sampleSize > 0 && (
          <p className="mt-2 text-[0.6875rem] text-text-faint">Across {asset.engagement.sampleSize} scraped post{asset.engagement.sampleSize === 1 ? "" : "s"}</p>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-text-faint">Rate card</p>
          {editable && !editing && (
            <button onClick={() => setEditing(true)} className="text-[0.75rem] font-semibold text-accent hover:text-accent-2">
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <div className="flex flex-col gap-2.5">
            {formats.map((f) => (
              <div key={f} className="flex items-center justify-between gap-3">
                <span className="text-[0.8125rem] capitalize text-text-muted">{f}</span>
                <input
                  type="number"
                  min={0}
                  value={amounts[f]}
                  onChange={(e) => setAmounts((prev) => ({ ...prev, [f]: e.target.value }))}
                  placeholder="—"
                  className="h-8 w-28 rounded-md border border-border-strong bg-surface-2 px-2.5 text-right text-[0.8125rem] text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            ))}
            <div className="flex items-center gap-2 border-t border-border pt-2.5">
              <input
                value={newFormat}
                onChange={(e) => setNewFormat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomFormat();
                  }
                }}
                placeholder="Add custom format (e.g. VOXPOP)"
                className="h-8 flex-1 rounded-md border border-border-strong bg-surface-2 px-2.5 text-[0.8125rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <button
                type="button"
                onClick={addCustomFormat}
                className="rounded-md border border-border-strong px-2.5 py-1 text-[0.75rem] font-semibold text-text-muted hover:bg-surface-hover"
              >
                Add
              </button>
            </div>
            {saveMutation.isError && (
              <ErrorNotice message={saveMutation.error instanceof ApiError ? saveMutation.error.message : "Couldn't save."} />
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" size="sm" className="flex-1" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" className="flex-1" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : asset.rateCards.length === 0 ? (
          <p className="text-[0.8125rem] text-text-faint">No rates set yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {asset.rateCards.map((rc) => (
              <div key={rc.id} className="flex items-center justify-between">
                <span className="text-[0.8125rem] capitalize text-text-muted">{rc.format}</span>
                <span className="text-[0.8125rem] font-bold tabular-nums">{money(rc.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EngagementStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-surface-2 px-2.5 py-2 text-center ring-1 ring-inset ring-border">
      <span className="text-[0.9375rem] font-bold tabular-nums">{value === null ? "N/A" : compactNumber(value)}</span>
      <span className="text-[0.6875rem] text-text-faint">{label}</span>
    </div>
  );
}

function NewAssetModal({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: () => void }) {
  const [handle, setHandle] = useState("");
  const [category, setCategory] = useState("");

  const createMutation = useMutation({
    mutationFn: () => assetsApi.create(token, handle, "instagram", category ? { category } : {}),
    onSuccess: onCreated,
  });

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[420px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="flex flex-col gap-5 overflow-y-auto p-6 pt-1"
      >
        <h2 className="text-lg font-bold">Add a page</h2>
        <Field label="Instagram handle">
          <TextField required value={handle} onChange={setHandle} placeholder="e.g. demo.page (without @)" />
        </Field>
        <Field label="Category (optional)">
          <CategoryPicker value={category} onChange={setCategory} />
        </Field>
        {createMutation.isError && (
          <ErrorNotice message={createMutation.error instanceof ApiError ? createMutation.error.message : "Couldn't add the page."} />
        )}
        <div className="flex gap-2.5">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Adding…" : "Add page"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

// ── Plans — pitch decks built from the pages above (admin-only, unchanged
// from the previous /inventory content apart from the section wrapper). ──

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
  /** Pages picked on the Pages tab before "Create plan" was clicked (newTask.md #13 / 8 Sep) — only meaningful for a brand-new plan. */
  initialAssetIds: string[];
}) {
  const queryClient = useQueryClient();
  const [deletingPlan, setDeletingPlan] = useState<Plan | null>(null);

  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: () => plansApi.list(token) });
  const items = plansQuery.data ?? [];

  const downloadMutation = useMutation({
    mutationFn: (plan: Plan) => plansApi.downloadPdf(token, plan.id, plan.name),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => plansApi.remove(token, id),
    onSuccess: () => {
      setDeletingPlan(null);
      queryClient.invalidateQueries({ queryKey: ["plans"] });
    },
  });
  // Approval workflow (newTask.md, 8 Sep) — server enforces who can call
  // which (Admin: any plan; Plan Maker: only their own, checked below via
  // ownsPlan so the buttons don't even appear for a plan that isn't theirs).
  const submitMutation = useMutation({
    mutationFn: (id: string) => plansApi.submit(token, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });
  const approveMutation = useMutation({
    mutationFn: (id: string) => plansApi.approve(token, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => plansApi.reject(token, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });
  const workflowBusy = submitMutation.isPending || approveMutation.isPending || rejectMutation.isPending;
  const workflowError = submitMutation.error ?? approveMutation.error ?? rejectMutation.error;

  return (
    <>
      {workflowError && (
        <ErrorNotice message={workflowError instanceof ApiError ? workflowError.message : "Couldn't update that plan's approval status."} />
      )}
      {plansQuery.isLoading ? (
        <div className="rounded-lg border border-border bg-surface shadow-card">
          <TableSkeleton />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface shadow-card">
          <EmptyState label="No plans yet." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((plan) => {
            // Admin can act on any plan; a Plan Maker only on their own —
            // mirrors plans/service.js's assertCanAccessPlan so the buttons
            // shown here never promise an action the server would reject.
            const ownsPlan = isAdmin || plan.createdBy?.id === currentUserId;
            return (
            <div key={plan.id} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card">
              <div className="flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-surface-2">
                  <InventoryIcon className="h-4 w-4 text-text-muted" />
                </div>
                {/* DRAFT/APPROVED/REJECTED are valid pill statuses as-is;
                    PENDING_APPROVAL borrows SCHEDULED's "awaiting" look. */}
                <StatusPill status={plan.status === "PENDING_APPROVAL" ? "SCHEDULED" : plan.status} />
              </div>
              <div>
                <p className="text-xs font-semibold text-text-faint">{plan.clientName}</p>
                <p className="mt-1 text-[0.9375rem] font-bold leading-snug">{plan.name}</p>
              </div>

              <div className="flex items-center gap-3 text-xs text-text-faint">
                <span className="flex items-center gap-1">
                  <HeartIcon className="h-3.5 w-3.5" />
                  {count(plan.expectedEngagement.likes)}
                </span>
                <span className="flex items-center gap-1">
                  <EyeIcon className="h-3.5 w-3.5" />
                  {count(plan.expectedEngagement.views)}
                </span>
                <span>
                  {plan.items.length} page{plan.items.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-text-faint">Total cost</span>
                <span className="font-bold tabular-nums">{money(plan.totalCost)}</span>
              </div>
              {plan.budgetVariance != null && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-faint">Budget</span>
                  <span className={cn("font-semibold", plan.budgetVariance < 0 ? "text-rose" : "text-accent")}>
                    {plan.budgetVariance < 0 ? `${money(Math.abs(plan.budgetVariance))} over` : `${money(plan.budgetVariance)} under`}
                  </span>
                </div>
              )}

              {/* Submit/approve/reject (newTask.md, 8 Sep) — only ever
                  shown to someone the server would actually let act:
                  Admin on anything, a Plan Maker only on their own plan. */}
              {ownsPlan && plan.status === "DRAFT" && (
                <Button size="sm" variant="secondary" onClick={() => submitMutation.mutate(plan.id)} disabled={workflowBusy}>
                  Submit for approval
                </Button>
              )}
              {ownsPlan && plan.status === "PENDING_APPROVAL" && (
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => approveMutation.mutate(plan.id)} disabled={workflowBusy}>
                    Approve
                  </Button>
                  <Button size="sm" variant="danger" className="flex-1" onClick={() => rejectMutation.mutate(plan.id)} disabled={workflowBusy}>
                    Reject
                  </Button>
                </div>
              )}

              <div className="flex gap-2">
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => setEditingPlan(plan)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => downloadMutation.mutate(plan)}
                  disabled={downloadMutation.isPending}
                >
                  <DownloadIcon className="h-3.5 w-3.5" />
                  PDF
                </Button>
                <Button size="icon" variant="danger" className="shrink-0" onClick={() => setDeletingPlan(plan)} aria-label="Delete plan">
                  ✕
                </Button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {editingPlan && (
        <PlanFormModal
          token={token}
          plan={editingPlan === "new" ? null : editingPlan}
          initialAssetIds={editingPlan === "new" ? initialAssetIds : []}
          onClose={() => setEditingPlan(null)}
          onSaved={() => {
            setEditingPlan(null);
            queryClient.invalidateQueries({ queryKey: ["plans"] });
          }}
        />
      )}

      {deletingPlan && (
        <Sheet onClose={() => setDeletingPlan(null)} panelClassName="md:max-w-[420px]">
          <div className="flex flex-col gap-5 overflow-y-auto p-6 pt-1">
            <h2 className="text-lg font-bold">Delete plan</h2>
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

interface DraftItem {
  assetId: string;
  format: string;
  cost: string; // blank = fall back to the page's rate card
  clientCost: string; // blank = show the internal cost as-is to the client
  postsPerProfile: string;
}

function PlanFormModal({
  token,
  plan,
  initialAssetIds,
  onClose,
  onSaved,
}: {
  token: string;
  plan: Plan | null;
  /** Pages pre-selected on the Pages tab (newTask.md #13 / 8 Sep) — only
   *  applied for a brand-new plan; an existing plan's own items always win. */
  initialAssetIds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(plan?.name ?? "");
  const [clientName, setClientName] = useState(plan?.clientName ?? "");
  const [clientContact, setClientContact] = useState(plan?.clientContact ?? "");
  const [budget, setBudget] = useState(plan?.budget ?? "");
  const [isGstPlan, setIsGstPlan] = useState(plan?.isGstPlan ?? false);
  const [categoryFilter, setCategoryFilter] = useState<string>("All");

  // Declared before `items` below so its lazy initializer can read
  // `allAssets` to default each pre-selected page's format/rate — by the
  // time a selection could have been made on the Pages tab, this same
  // ["assets"] query key was already resolved there, so React Query serves
  // it from cache here on the very first render, not a loading state.
  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token) });
  const allAssets = assetsQuery.data ?? [];
  const categories = useMemo(() => ["All", ...new Set(allAssets.map((a) => a.category).filter((c): c is string => Boolean(c)))], [allAssets]);
  const visibleAssets = categoryFilter === "All" ? allAssets : allAssets.filter((a) => a.category === categoryFilter);

  const [items, setItems] = useState<DraftItem[]>(() => {
    if (plan) {
      return plan.items.map((i) => ({
        assetId: i.assetId,
        format: i.format,
        cost: i.cost,
        clientCost: i.clientCost ?? "",
        postsPerProfile: String(i.postsPerProfile),
      }));
    }
    return initialAssetIds.map((assetId) => {
      const asset = allAssets.find((a) => a.id === assetId);
      return { assetId, format: asset?.rateCards[0]?.format ?? FORMATS[0], cost: "", clientCost: "", postsPerProfile: "1" };
    });
  });

  const itemByAsset = new Map(items.map((i) => [i.assetId, i]));

  function toggleAsset(asset: Asset) {
    setItems((prev) => {
      if (prev.some((i) => i.assetId === asset.id)) return prev.filter((i) => i.assetId !== asset.id);
      const defaultFormat = asset.rateCards[0]?.format ?? FORMATS[0];
      return [...prev, { assetId: asset.id, format: defaultFormat, cost: "", clientCost: "", postsPerProfile: "1" }];
    });
  }
  function updateItem(assetId: string, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((i) => (i.assetId === assetId ? { ...i, ...patch } : i)));
  }

  // Live preview, mirroring plans/service.js's annotatePlan — the
  // authoritative numbers still come back from the server on save; this is
  // so the admin sees the effect of each pick before committing. Two cost
  // totals, same split as the server: `totalCost` is internal (this
  // admin's own budget tracking below); `overview` is what actually goes
  // on the client-facing PDF — never let the two get shown as one number.
  const postsFor = (item: DraftItem) => Math.max(1, Number(item.postsPerProfile) || 1);
  const internalCostFor = (item: DraftItem, asset: Asset | undefined) =>
    item.cost ? Number(item.cost) : Number(asset?.rateCards.find((rc) => rc.format === item.format)?.amount ?? 0);

  const totalCost = items.reduce((sum, item) => {
    const asset = allAssets.find((a) => a.id === item.assetId);
    return sum + internalCostFor(item, asset) * postsFor(item);
  }, 0);
  const clientSubtotal = items.reduce((sum, item) => {
    const asset = allAssets.find((a) => a.id === item.assetId);
    const cost = item.clientCost ? Number(item.clientCost) : internalCostFor(item, asset);
    return sum + cost * postsFor(item);
  }, 0);
  const gstAmount = isGstPlan ? Math.round(clientSubtotal * 0.18 * 100) / 100 : 0;
  const clientTotal = clientSubtotal + gstAmount;
  const totalPosts = items.reduce((sum, item) => sum + postsFor(item), 0);

  const budgetNum = budget ? Number(budget) : null;
  const variance = budgetNum != null ? budgetNum - totalCost : null;
  const selectedAssets = allAssets.filter((a) => itemByAsset.has(a.id));
  const totalFollowers = selectedAssets.reduce((sum, a) => sum + a.followers, 0);
  const expectedLikes = selectedAssets.reduce((sum, a) => sum + (a.engagement.avgLikes ?? 0), 0);
  const expectedViews = selectedAssets.reduce((sum, a) => sum + (a.engagement.avgViews ?? 0), 0);
  const expectedImpressions = items.reduce((sum, item) => {
    const asset = allAssets.find((a) => a.id === item.assetId);
    return sum + (asset?.engagement.avgViews ?? 0) * postsFor(item);
  }, 0);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name,
        clientName,
        clientContact: clientContact || undefined,
        budget: budget ? Number(budget) : undefined,
        isGstPlan,
        items: items.map<PlanItemInput>((i) => ({
          assetId: i.assetId,
          format: i.format,
          cost: i.cost ? Number(i.cost) : undefined,
          clientCost: i.clientCost ? Number(i.clientCost) : undefined,
          postsPerProfile: postsFor(i),
        })),
      };
      return plan ? plansApi.update(token, plan.id, body) : plansApi.create(token, body);
    },
    onSuccess: onSaved,
  });

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[620px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
        className="flex flex-1 min-h-0 flex-col gap-5 overflow-y-auto p-6 pt-1"
      >
        <h2 className="text-lg font-bold">{plan ? "Edit plan" : "New plan"}</h2>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Plan name">
            <TextField required value={name} onChange={setName} placeholder="e.g. Q1 Meme Page Push" />
          </Field>
          <Field label="Client name">
            <TextField required value={clientName} onChange={setClientName} placeholder="e.g. Solmate Coffee" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client contact (optional)">
            <TextField value={clientContact ?? ""} onChange={setClientContact} placeholder="Email or phone" />
          </Field>
          <Field label="Budget (optional)">
            <TextField type="number" value={budget ?? ""} onChange={setBudget} placeholder="e.g. 200000" />
          </Field>
        </div>

        <label className="flex items-center gap-2.5 text-[0.8125rem] text-text-muted">
          <input
            type="checkbox"
            checked={isGstPlan}
            onChange={(e) => setIsGstPlan(e.target.checked)}
            className="h-4 w-4 rounded accent-[var(--accent)]"
          />
          Add 18% GST on top of the client cost
        </label>

        <div className="border-t border-border pt-4">
          <p className="mb-2 text-[0.8125rem] font-semibold">Pages</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoryFilter(c)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[0.75rem] font-semibold transition-colors",
                  categoryFilter === c ? "border-accent bg-accent-soft text-accent" : "border-border text-text-muted hover:bg-surface-2"
                )}
              >
                {c}
              </button>
            ))}
          </div>

          {assetsQuery.isLoading ? (
            <p className="text-[0.8125rem] text-text-faint">Loading pages…</p>
          ) : visibleAssets.length === 0 ? (
            <p className="text-[0.8125rem] text-text-faint">No pages in this category.</p>
          ) : (
            <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto rounded-md border border-border p-2">
              {visibleAssets.map((asset) => {
                const item = itemByAsset.get(asset.id);
                const selected = Boolean(item);
                return (
                  <div key={asset.id} className={cn("flex flex-col gap-2 rounded-md p-2", selected && "bg-surface-2")}>
                    <label className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleAsset(asset)}
                        className="h-4 w-4 rounded accent-[var(--accent)]"
                      />
                      <span className="text-[0.8125rem] font-semibold">@{asset.handle}</span>
                      <span className="text-[0.75rem] text-text-faint">{count(asset.followers)} followers</span>
                      {asset.category && <span className="text-[0.75rem] text-text-faint">· {asset.category}</span>}
                    </label>
                    {selected && item && (
                      <div className="ml-6 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <select
                            value={item.format}
                            onChange={(e) => updateItem(asset.id, { format: e.target.value })}
                            className="h-8 rounded-md border border-border-strong bg-surface px-2 text-[0.75rem] text-text focus:outline-none"
                          >
                            {(asset.rateCards.length > 0 ? asset.rateCards.map((rc) => rc.format) : FORMATS).map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min={0}
                            value={item.cost}
                            onChange={(e) => updateItem(asset.id, { cost: e.target.value })}
                            placeholder={`₹ rate (${money(asset.rateCards.find((rc) => rc.format === item.format)?.amount ?? 0)})`}
                            className="h-8 w-40 rounded-md border border-border-strong bg-surface px-2 text-[0.75rem] text-text placeholder:text-text-faint focus:outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            value={item.postsPerProfile}
                            onChange={(e) => updateItem(asset.id, { postsPerProfile: e.target.value })}
                            title="Posts per profile"
                            className="h-8 w-20 rounded-md border border-border-strong bg-surface px-2 text-[0.75rem] text-text focus:outline-none"
                          />
                          <span className="text-[0.6875rem] text-text-faint">posts ·</span>
                          <input
                            type="number"
                            min={0}
                            value={item.clientCost}
                            onChange={(e) => updateItem(asset.id, { clientCost: e.target.value })}
                            placeholder="Client cost (optional)"
                            title="Client-facing cost, if different from the internal cost"
                            className="h-8 w-44 rounded-md border border-border-strong bg-surface px-2 text-[0.75rem] text-text placeholder:text-text-faint focus:outline-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Two blocks, deliberately not merged into one summary: the
            client-facing numbers (what actually goes on the PDF — same
            shape as the "CAMPAIGN OVERVIEW" tab in the example sheet) vs.
            this admin's own internal cost/budget tracking, which must
            never be the number that ends up in front of the client. */}
        <div className="flex flex-col gap-1.5 rounded-md border border-accent/30 bg-accent-soft/40 p-3.5 text-[0.8125rem]">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-accent">Client-facing overview (on the PDF)</p>
          <div className="flex items-center justify-between text-text-muted">
            <span>Total followers targeted</span>
            <span className="tabular-nums">{count(totalFollowers)}</span>
          </div>
          <div className="flex items-center justify-between text-text-muted">
            <span>Total posts</span>
            <span className="tabular-nums">{totalPosts}</span>
          </div>
          <div className="flex items-center justify-between text-text-muted">
            <span>Expected impressions (est.)</span>
            <span className="tabular-nums">{count(expectedImpressions)}</span>
          </div>
          <div className="flex items-center justify-between text-text-muted">
            <span>Cost</span>
            <span className="tabular-nums">{money(clientSubtotal)}</span>
          </div>
          {isGstPlan && (
            <div className="flex items-center justify-between text-text-muted">
              <span>GST (18%)</span>
              <span className="tabular-nums">{money(gstAmount)}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-accent/20 pt-1.5 font-bold">
            <span>Total cost</span>
            <span className="tabular-nums">{money(clientTotal)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 rounded-md border border-border p-3.5 text-[0.8125rem]">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-text-faint">Internal (not shown to the client)</p>
          <div className="flex items-center justify-between text-text-muted">
            <span>Expected engagement (avg.)</span>
            <span>
              {count(expectedLikes)} likes · {count(expectedViews)} views
            </span>
          </div>
          <div className="flex items-center justify-between font-bold">
            <span>Total cost</span>
            <span className="tabular-nums">{money(totalCost)}</span>
          </div>
          {variance != null && (
            <div className={cn("flex items-center justify-between", variance < 0 ? "text-rose" : "text-accent")}>
              <span>{variance < 0 ? "Over budget" : "Under budget"}</span>
              <span className="tabular-nums">{money(Math.abs(variance))}</span>
            </div>
          )}
        </div>

        {saveMutation.isError && (
          <ErrorNotice message={saveMutation.error instanceof ApiError ? saveMutation.error.message : "Couldn't save this plan."} />
        )}

        <div className="flex gap-2.5">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={saveMutation.isPending || !name.trim() || !clientName.trim()}>
            {saveMutation.isPending ? "Saving…" : plan ? "Save changes" : "Create plan"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
