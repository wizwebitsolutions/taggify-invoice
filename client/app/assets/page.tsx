"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField } from "@/components/ui/form-field";
import { CategoryPicker } from "@/components/ui/category-picker";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { PlusIcon, AssetIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { assets as assetsApi, LINK_FORMATS as FORMATS, ApiError, type Asset } from "@/lib/api-client";
import { money, initialsOf, roleLabel, compactNumber } from "@/lib/format";

export default function AssetsPage() {
  return (
    <RequireAuth>
      <AssetsContent />
    </RequireAuth>
  );
}

function AssetsContent() {
  const { user, accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const token = accessToken!;

  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token) });
  const items = assetsQuery.data ?? [];
  const isAdmin = user?.role === "ADMIN";
  const canAdd = user?.role === "CREATOR";

  return (
    <AppShell
      active="assets"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search pages…"
      topbarActions={
        canAdd ? (
          <Button size="default" onClick={() => setShowForm(true)}>
            <PlusIcon className="h-[15px] w-[15px] text-accent-ink" />
            Add page
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">Work</p>
            <h1 className="mb-1.5 text-[1.625rem] font-bold">Assets</h1>
            <p className="text-[0.9375rem] text-text-muted">Social profiles and their rate cards.</p>
          </div>
          {/* Desktop carries this same action in the topbar (hidden below md). */}
          {canAdd && (
            <Button size="icon" className="shrink-0 md:hidden" onClick={() => setShowForm(true)} aria-label="Add page">
              <PlusIcon className="h-4 w-4 text-accent-ink" />
            </Button>
          )}
        </div>

        {assetsQuery.isLoading ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <TableSkeleton />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <EmptyState label="No pages registered yet." />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {items.map((asset) => (
              <AssetCard key={asset.id} asset={asset} token={token} editable={isAdmin} />
            ))}
          </div>
        )}
      </div>

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
    </AppShell>
  );
}

function AssetCard({ asset, token, editable }: { asset: Asset; token: string; editable: boolean }) {
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
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2">
            <AssetIcon className="h-[18px] w-[18px] text-text-muted" />
          </div>
          <div>
            <p className="text-[0.9375rem] font-bold">@{asset.handle}</p>
            <p className="text-xs text-text-faint">
              {asset.followers.toLocaleString()} followers
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
