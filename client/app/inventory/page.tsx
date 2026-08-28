"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField } from "@/components/ui/form-field";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { PlusIcon, InventoryIcon, DownloadIcon, HeartIcon, EyeIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import {
  plans as plansApi,
  assets as assetsApi,
  PAGE_CATEGORIES,
  LINK_FORMATS,
  ApiError,
  type Plan,
  type Asset,
  type PlanItemInput,
} from "@/lib/api-client";
import { money, initialsOf, roleLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function InventoryPage() {
  return (
    <RequireAuth>
      <InventoryContent />
    </RequireAuth>
  );
}

function InventoryContent() {
  const { user, accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [editingPlan, setEditingPlan] = useState<Plan | "new" | null>(null);
  const [deletingPlan, setDeletingPlan] = useState<Plan | null>(null);
  const token = accessToken!;
  const isAdmin = user?.role === "ADMIN";

  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: () => plansApi.list(token), enabled: isAdmin });
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

  return (
    <AppShell
      active="inventory"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search plans…"
      topbarActions={
        isAdmin ? (
          <Button size="default" onClick={() => setEditingPlan("new")}>
            <PlusIcon className="h-[15px] w-[15px] text-accent-ink" />
            New plan
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">Work</p>
            <h1 className="mb-1.5 text-[1.625rem] font-bold">Inventory</h1>
            <p className="text-[0.9375rem] text-text-muted">Pitch decks for brand clients — pick pages, price it, export the PDF.</p>
          </div>
          {isAdmin && (
            <Button size="icon" className="shrink-0 md:hidden" onClick={() => setEditingPlan("new")} aria-label="New plan">
              <PlusIcon className="h-4 w-4 text-accent-ink" />
            </Button>
          )}
        </div>

        {!isAdmin ? (
          <div className="rounded-lg border border-border bg-surface p-8 text-center shadow-card">
            <p className="text-[0.9375rem] text-text-muted">Inventory is available to Admin accounts.</p>
          </div>
        ) : plansQuery.isLoading ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <TableSkeleton />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <EmptyState label="No plans yet." />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((plan) => (
              <div key={plan.id} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card">
                <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-surface-2">
                  <InventoryIcon className="h-4 w-4 text-text-muted" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-text-faint">{plan.clientName}</p>
                  <p className="mt-1 text-[0.9375rem] font-bold leading-snug">{plan.name}</p>
                </div>

                <div className="flex items-center gap-3 text-xs text-text-faint">
                  <span className="flex items-center gap-1">
                    <HeartIcon className="h-3.5 w-3.5" />
                    {plan.expectedEngagement.likes.toLocaleString()}
                  </span>
                  <span className="flex items-center gap-1">
                    <EyeIcon className="h-3.5 w-3.5" />
                    {plan.expectedEngagement.views.toLocaleString()}
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
            ))}
          </div>
        )}
      </div>

      {editingPlan && (
        <PlanFormModal
          token={token}
          plan={editingPlan === "new" ? null : editingPlan}
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
    </AppShell>
  );
}

interface DraftItem {
  assetId: string;
  format: string;
  cost: string; // blank = fall back to the page's rate card
}

function PlanFormModal({
  token,
  plan,
  onClose,
  onSaved,
}: {
  token: string;
  plan: Plan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(plan?.name ?? "");
  const [clientName, setClientName] = useState(plan?.clientName ?? "");
  const [clientContact, setClientContact] = useState(plan?.clientContact ?? "");
  const [budget, setBudget] = useState(plan?.budget ?? "");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [items, setItems] = useState<DraftItem[]>(
    plan?.items.map((i) => ({ assetId: i.assetId, format: i.format, cost: i.cost })) ?? []
  );

  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token) });
  const allAssets = assetsQuery.data ?? [];
  const categories = useMemo(() => ["All", ...new Set(allAssets.map((a) => a.category).filter((c): c is string => Boolean(c)))], [allAssets]);
  const visibleAssets = categoryFilter === "All" ? allAssets : allAssets.filter((a) => a.category === categoryFilter);

  const itemByAsset = new Map(items.map((i) => [i.assetId, i]));

  function toggleAsset(asset: Asset) {
    setItems((prev) => {
      if (prev.some((i) => i.assetId === asset.id)) return prev.filter((i) => i.assetId !== asset.id);
      const defaultFormat = asset.rateCards[0]?.format ?? LINK_FORMATS[0];
      return [...prev, { assetId: asset.id, format: defaultFormat, cost: "" }];
    });
  }
  function updateItem(assetId: string, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((i) => (i.assetId === assetId ? { ...i, ...patch } : i)));
  }

  // Live preview, mirroring plans/service.js's annotatePlan — the
  // authoritative numbers still come back from the server on save; this is
  // so the admin sees the effect of each pick before committing.
  const totalCost = items.reduce((sum, item) => {
    const asset = allAssets.find((a) => a.id === item.assetId);
    const cost = item.cost ? Number(item.cost) : Number(asset?.rateCards.find((rc) => rc.format === item.format)?.amount ?? 0);
    return sum + cost;
  }, 0);
  const budgetNum = budget ? Number(budget) : null;
  const variance = budgetNum != null ? budgetNum - totalCost : null;
  const selectedAssets = allAssets.filter((a) => itemByAsset.has(a.id));
  const expectedLikes = selectedAssets.reduce((sum, a) => sum + (a.engagement.avgLikes ?? 0), 0);
  const expectedViews = selectedAssets.reduce((sum, a) => sum + (a.engagement.avgViews ?? 0), 0);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name,
        clientName,
        clientContact: clientContact || undefined,
        budget: budget ? Number(budget) : undefined,
        items: items.map<PlanItemInput>((i) => ({ assetId: i.assetId, format: i.format, cost: i.cost ? Number(i.cost) : undefined })),
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
                      <span className="text-[0.75rem] text-text-faint">{asset.followers.toLocaleString()} followers</span>
                      {asset.category && <span className="text-[0.75rem] text-text-faint">· {asset.category}</span>}
                    </label>
                    {selected && item && (
                      <div className="ml-6 flex items-center gap-2">
                        <select
                          value={item.format}
                          onChange={(e) => updateItem(asset.id, { format: e.target.value })}
                          className="h-8 rounded-md border border-border-strong bg-surface px-2 text-[0.75rem] text-text focus:outline-none"
                        >
                          {(asset.rateCards.length > 0 ? asset.rateCards.map((rc) => rc.format) : LINK_FORMATS).map((f) => (
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
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5 rounded-md border border-border p-3.5 text-[0.8125rem]">
          <div className="flex items-center justify-between text-text-muted">
            <span>Expected engagement (avg.)</span>
            <span>
              {expectedLikes.toLocaleString()} likes · {expectedViews.toLocaleString()} views
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
