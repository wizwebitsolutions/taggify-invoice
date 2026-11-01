"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, ClipboardCheck, CreditCard, ExternalLink, Users } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { useApprovalSources } from "@/lib/queries/approvals";
import {
  ApiError,
  assets as assetsApi,
  billing as billingApi,
  links as linksApi,
  plans as plansApi,
  type Asset,
  type BillingProfile,
  type Campaign,
  type Link as Post,
  type Plan,
} from "@/lib/api-client";
import { captionTitle, formatLabel, latestSnapshot, postThumbSrc } from "@/lib/finance";
import { count, personLabel, plural, roleLabel } from "@/lib/format";
import { isDecidable, margin, planPages, planValue } from "@/lib/plans";
import { canEditPages, rateOf } from "@/lib/creators";
import { FORMATS, formatLabel as rateLabel } from "@/lib/formats";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterSelect } from "@/components/taggify/filter-select";
import { SegmentedFilter } from "@/components/taggify/segmented-filter";
import { EmptyState } from "@/components/taggify/illustration";
import { Money } from "@/components/taggify/money";
import { PlatformIcon } from "@/components/taggify/platform-icon";
import { StatusPill } from "@/components/taggify/status-pill";
import { UserAvatar } from "@/components/taggify/user-avatar";
import { audienceLabel, ContentThumb, displayHandle, PageAvatar, PageAvatarStack } from "@/components/finance/identity";
import { LoadError, NoAccess } from "@/components/finance/states";
import { PageSheet } from "@/components/creators/page-sheet";

type Kind = "proof" | "insights" | "plan" | "people" | "page" | "page-edit" | "billing";
const KIND: Record<Kind, string> = { proof: "Proof", insights: "Insights", plan: "Plan", people: "Sheet rows", page: "New page", "page-edit": "Page edit", billing: "Bank details" };
// The queue is filtered by category first (1 Nov — "categorize the approval page"), then by kind within it.
type Category = "posts" | "inventory" | "plans" | "sheet" | "bank";
const CATEGORY: Record<Category, { label: string; kinds: Kind[] }> = {
  posts: { label: "Posts", kinds: ["proof", "insights"] },
  inventory: { label: "Inventory", kinds: ["page", "page-edit"] },
  plans: { label: "Plans", kinds: ["plan"] },
  sheet: { label: "Sheet rows", kinds: ["people"] },
  bank: { label: "Bank details", kinds: ["billing"] },
};
const CATEGORIES = Object.keys(CATEGORY) as Category[];
const categoryOf = (k: Kind): Category => CATEGORIES.find((c) => CATEGORY[c].kinds.includes(k))!;
/** New pages are grouped by who added them; pages from before that was recorded share one group. */
const UNTRACKED = "untracked";

type Item =
  | { kind: "proof" | "insights"; id: string; title: string; sub: string; since: string; post: Post }
  | { kind: "plan"; id: string; title: string; sub: string; since: string; plan: Plan }
  | { kind: "people"; id: string; title: string; sub: string; since: string; campaign: Campaign }
  | { kind: "page"; id: string; title: string; sub: string; since: string; asset: Asset }
  // A planner's suggested edit to an existing page (16 Oct): apply or discard.
  | { kind: "page-edit"; id: string; title: string; sub: string; since: string; asset: Asset }
  | { kind: "billing"; id: string; title: string; sub: string; since: string; profile: BillingProfile };

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const waited = (iso: string) => {
  const h = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
  return h < 24 ? `${Math.max(1, h)}h` : `${Math.round(h / 24)}d`;
};

export default function ApprovalsPage() {
  return (
    <AppShell active="approvals">
      <Suspense>
        <Approvals />
      </Suspense>
    </AppShell>
  );
}

/**
 * Approvals inbox: queue on the left, the evidence in the middle, context on
 * the right. Each kind is its own permission (links.approve, plans.approve,
 * inventory.approve, finance.pay), so someone holding just one gets a working
 * queue for that kind and never sees the rest. "Approve & next" keeps you in flow.
 */
function Approvals() {
  const { user, accessToken } = useAuth();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { can, linksQ, plansQ, assetsQ, billingQ, campaignsQ } = useApprovalSources();
  const token = accessToken ?? "";

  // ?type=<kind> deep links (home, content, finance) land on that kind's category with the kind picked.
  const initial = params.get("type") as Kind | null;
  const initialKind = initial && initial in KIND ? initial : null;
  const [filter, setFilter] = useState<"all" | Category>(initialKind ? categoryOf(initialKind) : "all");
  const [sub, setSub] = useState<"all" | Kind>(initialKind ?? "all");
  const [sort, setSort] = useState("oldest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reject, setReject] = useState<Item | null>(null);
  // Ticked new pages for "Approve selected" (1 Nov).
  const [bulk, setBulk] = useState<Set<string>>(new Set());
  // A page opened from its approval card to set missing rates (the live row, so the sheet shows saved changes).
  const [ratesPageId, setRatesPageId] = useState<string | null>(null);
  const ratesPage = (assetsQ.data ?? []).find((a) => a.id === ratesPageId) ?? null;
  const mayEditPages = canEditPages(user);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const l of linksQ.data?.items ?? []) {
      const title = captionTitle(latestSnapshot(l)?.caption) ?? formatLabel(l.format);
      out.push({ kind: l.status === "PENDING_SCREENSHOT_REVIEW" ? "proof" : "insights", id: `l:${l.id}`, title, sub: `${displayHandle(l.asset?.handle ?? "—", l.asset?.platform)} · ${l.campaign?.title ?? "—"}`, since: l.createdAt, post: l });
    }
    for (const p of (plansQ.data ?? []).filter(isDecidable)) out.push({ kind: "plan", id: `p:${p.id}`, title: `${p.name} (${p.variantLabel})`, sub: `${p.createdBy?.name ?? "—"} · ${p.clientName}`, since: p.updatedAt, plan: p });
    for (const c of (campaignsQ.data ?? []).filter((c) => (c.pendingAssignmentCount ?? 0) > 0)) out.push({ kind: "people", id: `c:${c.id}`, title: `${plural(c.pendingAssignmentCount ?? 0, "page")} to match`, sub: c.title, since: c.createdAt, campaign: c });
    for (const a of (assetsQ.data ?? []).filter((a) => a.approvalStatus === "pending")) out.push({ kind: "page", id: `a:${a.id}`, title: displayHandle(a.handle, a.platform), sub: `Added by ${personLabel(a.createdBy, "—")} · ${a.owner?.name ?? "—"} · ${audienceLabel(a.followers, a.platform)}`, since: a.createdAt, asset: a });
    for (const a of (assetsQ.data ?? []).filter((a) => a.pendingEdit && typeof a.pendingEdit === "object")) out.push({ kind: "page-edit", id: `e:${a.id}`, title: `${displayHandle(a.handle, a.platform)} · suggested edit`, sub: `by ${a.pendingEditBy?.name ?? a.pendingEditBy?.email ?? "a planner"}`, since: a.pendingEditAt ?? a.createdAt, asset: a });
    for (const b of (billingQ.data ?? []).filter((b) => b.approvalStatus === "pending")) out.push({ kind: "billing", id: `b:${b.id}`, title: b.user?.name ?? b.name, sub: `•••• ${b.bankAccountNumber.slice(-4)} · ${b.ifscCode}`, since: b.createdAt, profile: b });
    return out;
  }, [linksQ.data, plansQ.data, campaignsQ.data, assetsQ.data, billingQ.data]);

  const counts = useMemo(() => {
    const c = { proof: 0, insights: 0, plan: 0, people: 0, page: 0, "page-edit": 0, billing: 0 } as Record<Kind, number>;
    items.forEach((i) => c[i.kind]++);
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const rows = filter === "all" ? items : items.filter((i) => categoryOf(i.kind) === filter && (sub === "all" || i.kind === sub));
    return [...rows].sort((a, b) => (sort === "oldest" ? 1 : -1) * (new Date(a.since).getTime() - new Date(b.since).getTime()));
  }, [items, filter, sub, sort]);
  const selected = visible.find((i) => i.id === selectedId) ?? visible[0] ?? null;
  // New pages on their own: grouped by who added them, with tick boxes for a bulk decision.
  const grouped = filter === "inventory" && sub === "page";
  const pageItems = useMemo(() => (grouped ? visible.filter((i): i is Extract<Item, { kind: "page" }> => i.kind === "page") : []), [grouped, visible]);

  function next() {
    const idx = visible.findIndex((i) => i.id === selected?.id);
    const after = visible[idx + 1] ?? visible[idx - 1] ?? null;
    setSelectedId(after?.id ?? null);
  }
  async function refresh() {
    await Promise.all(["links", "plans", "assets", "billing", "campaigns", "payments"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  }

  const decide = useMutation({
    mutationFn: async ({ item, approve, note }: { item: Item; approve: boolean; note?: string; andNext?: boolean }) => {
      switch (item.kind) {
        case "proof":
          return linksApi.reviewScreenshot(token, item.post.id, approve, note);
        case "insights":
          return linksApi.approveInsights(token, item.post.id);
        case "plan":
          return approve ? plansApi.approve(token, item.plan.id) : plansApi.reject(token, item.plan.id);
        case "page":
          return assetsApi.setApproval(token, item.asset.id, approve ? "approved" : "rejected");
        case "page-edit":
          return assetsApi.decideEdit(token, item.asset.id, approve ? "approve" : "reject");
        case "billing":
          return billingApi.setApproval(token, item.profile.id, approve ? "approved" : "rejected");
        default:
          return null;
      }
    },
    onSuccess: async (_r, { item, approve, andNext }: { item: Item; approve: boolean; note?: string; andNext?: boolean }) => {
      if (andNext) next();
      setReject(null);
      toast.success(`${KIND[item.kind]} ${approve ? "approved" : "rejected"}: ${item.title}`);
      await refresh();
    },
    onError: (e) => toast.error(errText(e, "That decision didn't go through. Try again.")),
  });
  const bulkDecide = useMutation({
    mutationFn: (status: "approved" | "rejected") => assetsApi.setApprovalMany(token, [...bulk], status),
    onSuccess: async (r, status) => {
      setBulk(new Set());
      setSelectedId(null);
      toast.success(`${plural(r.updated.length, "page")} ${status}${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}.`);
      await refresh();
    },
    onError: (e) => toast.error(errText(e, "That didn't go through. Try again.")),
  });

  if (!can.links && !can.plans && !can.pages && !can.billing) return <NoAccess what="approvals" />;
  const loading = linksQ.isLoading || plansQ.isLoading || assetsQ.isLoading || billingQ.isLoading;
  const failed = [linksQ, plansQ, assetsQ, billingQ, campaignsQ].find((q) => q.isError);
  const kinds = (Object.keys(KIND) as Kind[]).filter((k) => (k === "proof" || k === "insights" ? can.links : k === "people" ? can.people : k === "plan" ? can.plans : k === "page" || k === "page-edit" ? can.pages : can.billing));
  const categoryCount = (c: Category) => CATEGORY[c].kinds.reduce((n, k) => n + counts[k], 0);
  const categories = CATEGORIES.filter((c) => CATEGORY[c].kinds.some((k) => kinds.includes(k)) && (categoryCount(c) > 0 || filter === c));
  const subKinds = filter === "all" ? [] : CATEGORY[filter].kinds.filter((k) => kinds.includes(k));
  const emptyLabel = filter === "all" ? "All clear" : `No ${(sub !== "all" ? KIND[sub] : CATEGORY[filter].label).toLowerCase()} waiting`;

  return (
    <div className="workspace-page">
      <div className="page-heading">
        <div className="page-heading-copy">
          <h1 className="text-display">Approvals</h1>
          <p className="mt-1 text-body text-muted-foreground">Clear the queue one item at a time. Approve &amp; next moves straight on.</p>
        </div>
        <FilterSelect
          className="ml-auto"
          label="Sort"
          value={sort}
          onValueChange={setSort}
          options={[
            { value: "oldest", label: "Waiting longest" },
            { value: "newest", label: "Newest" },
          ]}
        />
      </div>

      <SegmentedFilter
        variant="pills"
        label="Show approvals"
        value={filter}
        onChange={(c) => {
          setFilter(c);
          setSub("all");
          setSelectedId(null);
          setBulk(new Set());
        }}
        options={(["all", ...categories] as ("all" | Category)[]).map((c) => ({ value: c, label: c === "all" ? "All" : CATEGORY[c].label, count: c === "all" ? items.length : categoryCount(c) }))}
      />
      {subKinds.length > 1 && filter !== "all" && (
        <SegmentedFilter
          label={`Show ${CATEGORY[filter].label.toLowerCase()}`}
          value={sub}
          onChange={(k) => {
            setSub(k);
            setSelectedId(null);
            setBulk(new Set());
          }}
          options={(["all", ...subKinds] as ("all" | Kind)[]).map((k) => ({ value: k, label: k === "all" ? "All" : KIND[k], count: k === "all" ? categoryCount(filter) : counts[k] }))}
        />
      )}

      {failed && <LoadError onRetry={() => failed.refetch()} what="part of the queue" />}

      {grouped && bulk.size > 0 && (
        <div role="region" aria-label="Selected pages" className="flex flex-wrap items-center gap-2 rounded-card border bg-card px-4 py-2 text-small">
          <span className="font-semibold">{plural(bulk.size, "page")} selected</span>
          <Button size="sm" variant="success" disabled={bulkDecide.isPending} onClick={() => bulkDecide.mutate("approved")}>
            {bulkDecide.isPending ? "Working…" : "Approve selected"}
          </Button>
          <Button size="sm" variant="outline" className="text-danger-fg" disabled={bulkDecide.isPending} onClick={() => bulkDecide.mutate("rejected")}>
            Reject selected
          </Button>
          <Button size="sm" variant="ghost" disabled={bulkDecide.isPending} onClick={() => setBulk(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <Card className="approval-workspace grid min-h-[560px] overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        <ol aria-label="Queue" className="approval-queue flex max-h-[720px] flex-col overflow-y-auto border-b lg:border-b-0 lg:border-r">
          {loading
            ? [0, 1, 2, 3].map((i) => (
                <li key={i} className="p-4">
                  <Skeleton className="h-10 w-full" />
                </li>
              ))
            : grouped
              ? <PageGroups items={pageItems} selectedId={selected?.id ?? null} onSelect={setSelectedId} bulk={bulk} setBulk={setBulk} />
              : visible.map((i) => (
                  <li key={i.id}>
                    <QueueRow item={i} current={selected?.id === i.id} onSelect={() => setSelectedId(i.id)} />
                  </li>
                ))}
          {!loading && visible.length === 0 && (
            <li>
              <EmptyState name="payout-success" title={emptyLabel}>
                Nothing needs your decision right now.
              </EmptyState>
            </li>
          )}
        </ol>

        {selected ? (
          <>
            <section aria-label="Evidence" className="flex min-w-0 flex-col gap-6 p-5 md:p-6 2xl:border-r">
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill tone="info">{KIND[selected.kind]}</StatusPill>
                <h2 className="min-w-0 truncate text-section">{selected.title}</h2>
              </div>
              <Evidence item={selected} onSetRates={mayEditPages ? setRatesPageId : undefined} />
              <Decision
                item={selected}
                busy={decide.isPending}
                onApprove={(andNext) => decide.mutate({ item: selected, approve: true, andNext })}
                onReject={() => setReject(selected)}
              />
            </section>
            <aside aria-label="Context" className="approval-context flex flex-col gap-4 border-t p-6 2xl:border-t-0">
              <h2 className="text-card-title">Context</h2>
              <Context item={selected} />
            </aside>
          </>
        ) : (
          !loading && <div className="hidden lg:block" />
        )}
      </Card>

      <PageSheet page={ratesPage} startEditing onClose={() => setRatesPageId(null)} />
      <RejectDialog item={reject} busy={decide.isPending} onClose={() => setReject(null)} onReject={(note) => reject && decide.mutate({ item: reject, approve: false, note, andNext: true })} />
    </div>
  );
}

function QueueRow({ item, current, onSelect, className }: { item: Item; current: boolean; onSelect: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-current={current ? "true" : undefined}
      onClick={onSelect}
      className={cn("flex w-full items-center gap-3 border-b border-l-3 border-l-transparent px-4 py-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-inset focus-visible:ring-ring-soft", current && "border-l-brand bg-brand-50", className)}
    >
      <QueueIcon item={item} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-strong">{item.title}</span>
        <span className="block truncate text-small text-fg-muted">
          {KIND[item.kind]} · {item.sub}
        </span>
      </span>
      <span className="text-small text-fg-muted">{waited(item.since)}</span>
    </button>
  );
}

type PageItem = Extract<Item, { kind: "page" }>;

/**
 * New pages grouped by who added them (1 Nov): "this plan maker added these
 * pages", tick the whole group or single pages, then "Approve selected" above
 * the queue. Pages from before the adder was recorded share one last group.
 * The tick box sits beside the row's button, never inside it.
 */
function PageGroups({ items, selectedId, onSelect, bulk, setBulk }: { items: PageItem[]; selectedId: string | null; onSelect: (id: string) => void; bulk: Set<string>; setBulk: (next: Set<string>) => void }) {
  const groups = useMemo(() => {
    const byAdder = new Map<string, { key: string; label: string; role: string; items: PageItem[] }>();
    for (const i of items) {
      const by = i.asset.createdBy;
      const key = by?.id ?? UNTRACKED;
      const g = byAdder.get(key) ?? { key, label: by ? personLabel(by) : "Added before tracking", role: by ? roleLabel(by.role) : "", items: [] };
      g.items.push(i);
      byAdder.set(key, g);
    }
    return [...byAdder.values()].sort((a, b) => (a.key === UNTRACKED ? 1 : b.key === UNTRACKED ? -1 : a.label.localeCompare(b.label)));
  }, [items]);

  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(bulk);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setBulk(next);
  };

  return (
    <>
      {groups.map((g) => {
        const ids = g.items.map((i) => i.asset.id);
        const ticked = ids.filter((id) => bulk.has(id)).length;
        return (
          <li key={g.key}>
            <div role="group" aria-label={g.label} className="sticky top-0 z-10 flex items-center gap-3 border-b bg-muted px-4 py-2 text-small">
              <Checkbox aria-label={`Select all from ${g.label}`} checked={ticked === ids.length ? true : ticked > 0 ? "indeterminate" : false} onCheckedChange={(v) => toggle(ids, v === true)} />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold">{g.label}</span>
                <span className="text-fg-muted">
                  {g.role ? ` · ${g.role}` : ""} · {plural(ids.length, "page")}
                </span>
              </span>
            </div>
            <ol>
              {g.items.map((i) => (
                <li key={i.id} className="flex items-center">
                  <Checkbox className="ml-4" aria-label={`Select ${i.title}`} checked={bulk.has(i.asset.id)} onCheckedChange={(v) => toggle([i.asset.id], v === true)} />
                  <QueueRow item={i} current={selectedId === i.id} onSelect={() => onSelect(i.id)} className="min-w-0 flex-1" />
                </li>
              ))}
            </ol>
          </li>
        );
      })}
    </>
  );
}

function QueueIcon({ item }: { item: Item }) {
  if (item.kind === "proof" || item.kind === "insights") return <ContentThumb src={postThumbSrc(item.post)} format={item.post.format} />;
  if (item.kind === "page" || item.kind === "page-edit") return <PageAvatar assetId={item.asset.id} handle={item.asset.handle} size="md" />;
  const Icon = item.kind === "plan" ? ClipboardCheck : item.kind === "billing" ? CreditCard : Users;
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-brand-soft text-brand-ink">
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  );
}

function Evidence({ item, onSetRates }: { item: Item; onSetRates?: (assetId: string) => void }) {
  if (item.kind === "proof") {
    const shot = item.post.screenshot?.url;
    return (
      <div className="flex flex-col gap-3">
        {shot ? (
          <ProofImage src={shot} alt={`Proof screenshot for ${item.title}`} />
        ) : (
          <p className="rounded-lg bg-muted p-6 text-center text-small text-muted-foreground">No screenshot attached yet.</p>
        )}
        <a href={item.post.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-small font-semibold underline underline-offset-4">
          Open the post <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>
    );
  }
  if (item.kind === "insights") {
    const s = latestSnapshot(item.post) as (ReturnType<typeof latestSnapshot> & { saves?: number; shares?: number }) | null;
    if (!s) return <p className="text-small text-muted-foreground">No insights captured yet.</p>;
    return (
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["Views", s.videoViews],
              ["Likes", s.likeCount],
              ["Comments", s.commentsCount],
            ] as const
          ).map(([label, v]) => (
            <Card key={label} className="p-4">
              <p className="text-small text-muted-foreground">{label}</p>
              <p className="num text-section">{v >= 0 ? count(v) : "—"}</p>
            </Card>
          ))}
        </div>
        <p className="text-small text-muted-foreground">Captured {new Date(s.capturedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.</p>
        <a href={item.post.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-small font-semibold underline underline-offset-4">
          Open the post <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>
    );
  }
  if (item.kind === "plan") {
    const p = item.plan;
    return (
      <dl className="grid max-w-lg grid-cols-[1fr_auto] gap-y-2 text-body">
        <dt className="text-muted-foreground">Client</dt>
        <dd className="text-right font-semibold">{p.clientName}</dd>
        <dt className="text-muted-foreground">Pages</dt>
        <dd className="flex items-center justify-end gap-2 font-semibold">
          <PageAvatarStack pages={planPages(p)} />
          {plural(p.overview.totalPosts, "post")}
        </dd>
        <dt className="text-muted-foreground">Client price</dt>
        <dd className="text-right font-semibold">
          <Money value={planValue(p)} />
          {p.gstPercent ? ` + ${p.gstPercent}% GST` : ""}
        </dd>
        <dt className="text-muted-foreground">Internal cost</dt>
        <dd className="text-right font-semibold">
          <Money value={p.totalCost} />
        </dd>
        <dt className="text-muted-foreground">Margin</dt>
        <dd className="text-right font-semibold text-success-fg">
          <Money value={margin(p)} />
        </dd>
      </dl>
    );
  }
  if (item.kind === "page") {
    const a = item.asset;
    const header = (
      <div className="flex items-center gap-4">
        <PageAvatar assetId={a.id} handle={a.handle} size="lg" />
        <div>
          <p className="flex items-center gap-1 text-card-title">
            <PlatformIcon platform={a.platform} />
            {displayHandle(a.handle, a.platform)}
          </p>
          <p className="text-small text-muted-foreground">
            {audienceLabel(a.followers, a.platform)} · {a.category ?? "No category"}
          </p>
          {a.lastScrapeError && <p className="mt-1 text-small text-warning-fg">Couldn&apos;t fetch the profile: {a.lastScrapeError}</p>}
        </div>
      </div>
    );
    const priced = FORMATS.filter((f) => rateOf(a, f) != null);
    return (
      <div className="flex flex-col gap-4">
        {header}
        <dl className="grid max-w-lg grid-cols-[1fr_auto] gap-y-2 text-body">
          <div className="contents">
            <dt className="text-muted-foreground">Grade</dt>
            <dd className="text-right font-semibold">{a.grade ? `Grade ${a.grade}` : <span className="font-normal text-muted-foreground">Not graded</span>}</dd>
          </div>
          {priced.length === 0 ? (
            <div className="contents">
              <dt className="text-muted-foreground">Rates</dt>
              <dd className="text-right font-normal text-muted-foreground">None yet (optional)</dd>
            </div>
          ) : (
            priced.map((f) => (
              <div key={f} className="contents">
                <dt className="text-muted-foreground">{rateLabel(f)} rate</dt>
                <dd className="text-right font-semibold">
                  <Money value={rateOf(a, f)!} />
                </dd>
              </div>
            ))
          )}
        </dl>
        {onSetRates && (
          <Button size="sm" variant="outline" className="self-start" onClick={() => onSetRates(a.id)}>
            Edit page details
          </Button>
        )}
      </div>
    );
  }
  if (item.kind === "page-edit") {
    const a = item.asset;
    const e = a.pendingEdit ?? {};
    const rows: [string, string, string][] = [];
    if ("category" in e) rows.push(["Category", a.category ?? "—", e.category ?? "—"]);
    if ("grade" in e) rows.push(["Grade", a.grade ?? "—", e.grade ?? "—"]);
    if ("groupLink" in e) rows.push(["Group link", a.groupLink ?? "—", e.groupLink ?? "—"]);
    for (const rc of e.rateCards ?? []) {
      const current = rateOf(a, rc.format);
      rows.push([`${rateLabel(rc.format)} rate`, current != null ? `₹${current.toLocaleString("en-IN")}` : "—", `₹${Number(rc.amount).toLocaleString("en-IN")}`]);
    }
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <PageAvatar assetId={a.id} handle={a.handle} size="lg" />
          <div>
            <p className="flex items-center gap-1 text-card-title">
              <PlatformIcon platform={a.platform} />
              {displayHandle(a.handle, a.platform)}
            </p>
            <p className="text-small text-muted-foreground">Approve applies these changes to the page. Reject discards them and leaves the page as it is.</p>
          </div>
        </div>
        <dl className="grid max-w-lg grid-cols-[1fr_auto_auto] gap-x-6 gap-y-2 text-body" data-testid="page-edit-diff">
          <div className="contents text-th uppercase text-muted-foreground">
            <dt>Field</dt>
            <dd className="text-right">Now</dd>
            <dd className="text-right">Suggested</dd>
          </div>
          {rows.map(([label, from, to]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right text-fg-muted line-through">{from}</dd>
              <dd className="text-right font-semibold">{to}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  if (item.kind === "billing") {
    const b = item.profile;
    return (
      <dl className="grid max-w-lg grid-cols-[1fr_auto] gap-y-2 text-body">
        <dt className="text-muted-foreground">Name on PAN</dt>
        <dd className="text-right font-semibold">{b.name}</dd>
        <dt className="text-muted-foreground">PAN</dt>
        <dd className="text-right font-semibold">{b.pan}</dd>
        <dt className="text-muted-foreground">Account</dt>
        <dd className="text-right font-semibold">{b.bankAccountNumber}</dd>
        <dt className="text-muted-foreground">IFSC</dt>
        <dd className="text-right font-semibold">{b.ifscCode}</dd>
        <dt className="text-muted-foreground">GSTIN</dt>
        <dd className="text-right font-semibold">{b.gstin || "Not registered"}</dd>
      </dl>
    );
  }
  return <p className="text-body text-muted-foreground">Rows from this campaign&apos;s sheet name pages that aren&apos;t in Inventory yet. Add each page in Inventory, then match it on the campaign.</p>;
}

function ProofImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <p className="rounded-lg bg-muted p-6 text-center text-small text-muted-foreground">
        Couldn&apos;t load the screenshot.{" "}
        <a href={src} target="_blank" rel="noreferrer" className="font-semibold text-foreground underline underline-offset-4">
          Open it directly
        </a>
        .
      </p>
    );
  // eslint-disable-next-line @next/next/no-img-element -- Cloudinary proof screenshot
  return <img src={src} alt={alt} onError={() => setFailed(true)} className="max-h-[440px] w-auto self-start rounded-lg border object-contain" />;
}

function Decision({ item, busy, onApprove, onReject }: { item: Item; busy: boolean; onApprove: (andNext: boolean) => void; onReject: () => void }) {
  if (item.kind === "people") {
    return (
      <Button asChild className="self-start">
        <Link href={`/campaigns/${item.campaign.id}`}>
          Open the campaign
          <ArrowRight />
        </Link>
      </Button>
    );
  }
  const canReject = item.kind !== "insights";
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => onApprove(true)}>
          Approve &amp; next
          <ArrowRight />
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => onApprove(false)}>
          Approve
        </Button>
        {canReject && (
          <Button variant="outline" className="text-danger-fg" disabled={busy} onClick={onReject}>
            Reject…
          </Button>
        )}
      </div>
      <p className="text-small text-muted-foreground">
        {item.kind === "plan"
          ? "Approving creates the campaign and shows it to every page's owner."
          : item.kind === "proof"
            ? "Rejecting asks for a reason, which the creator sees so they can re-upload."
            : item.kind === "insights"
              ? "Approving marks the post verified. If the numbers look wrong, ask the creator to refresh them."
              : item.kind === "billing"
                ? "Approved bank details are what Finance pays into."
                : item.kind === "page-edit"
                  ? "Approving applies the suggested changes to the page. Rejecting discards them."
                  : "Approved pages can be added to plans and campaigns."}
      </p>
    </div>
  );
}

function Context({ item }: { item: Item }) {
  if (item.kind === "proof" || item.kind === "insights") {
    const l = item.post;
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-small">
        <dt className="text-muted-foreground">Campaign</dt>
        <dd className="text-right font-semibold">{l.campaign ? <Link href={`/campaigns/${l.campaign.id}`} className="underline underline-offset-4">{l.campaign.title}</Link> : "—"}</dd>
        <dt className="text-muted-foreground">Page</dt>
        <dd className="text-right font-semibold">{displayHandle(l.asset?.handle ?? "—", l.asset?.platform)}</dd>
        <dt className="text-muted-foreground">Owner</dt>
        <dd className="text-right font-semibold">{personLabel((l.asset as (Asset & { owner?: { name: string | null; email?: string | null } }) | undefined)?.owner)}</dd>
        <dt className="text-muted-foreground">Format</dt>
        <dd className="text-right font-semibold">{formatLabel(l.format)}</dd>
        <dt className="text-muted-foreground">Cost</dt>
        <dd className="text-right font-semibold">
          <Money value={l.cost} />
        </dd>
        <dt className="text-muted-foreground">Submitted</dt>
        <dd className="text-right font-semibold">{new Date(l.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</dd>
        {l.overQuota && (
          <>
            <dt className="text-muted-foreground">Booking</dt>
            <dd className="text-right font-semibold text-warning-fg">Over what was booked</dd>
          </>
        )}
      </dl>
    );
  }
  if (item.kind === "plan") {
    return (
      <div className="flex flex-col gap-3 text-small">
        <span className="flex items-center gap-2">
          <UserAvatar name={item.plan.createdBy?.name} size="sm" />
          <span>
            <span className="block font-semibold">{item.plan.createdBy?.name ?? "—"}</span>
            <span className="text-muted-foreground">Planner</span>
          </span>
        </span>
        {item.plan.notes && <p className="rounded-md bg-muted p-3">{item.plan.notes}</p>}
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link href={`/plans/${item.plan.id}`}>Open full plan</Link>
        </Button>
      </div>
    );
  }
  if (item.kind === "billing") {
    return (
      <div className="flex flex-col gap-2 text-small">
        <span className="font-semibold">{personLabel(item.profile.user)}</span>
        <span className="text-muted-foreground">{item.profile.user?.email ?? item.profile.user?.phoneNumber ?? ""}</span>
        <span className="text-muted-foreground">Added {new Date(item.profile.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
      </div>
    );
  }
  if (item.kind === "page-edit") {
    return (
      <div className="flex flex-col gap-2 text-small">
        <span className="font-semibold">{item.asset.pendingEditBy?.name ?? item.asset.pendingEditBy?.email ?? "A planner"}</span>
        <span className="text-muted-foreground">Suggested the change</span>
        {item.asset.pendingEditAt && <span className="text-muted-foreground">On {new Date(item.asset.pendingEditAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>}
      </div>
    );
  }
  if (item.kind === "page") {
    const { owner, createdBy } = item.asset;
    return (
      <div className="flex flex-col gap-3 text-small">
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">{createdBy ? personLabel(createdBy) : "Added before tracking"}</span>
          <span className="text-muted-foreground">Added by{createdBy ? ` · ${roleLabel(createdBy.role)}` : ""}</span>
          <span className="text-muted-foreground">On {new Date(item.asset.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">{personLabel(owner)}</span>
          <span className="text-muted-foreground">Page owner</span>
        </span>
      </div>
    );
  }
  if (item.kind === "people") return <p className="text-small text-muted-foreground">{item.campaign.title}</p>;
  return null;
}

function RejectDialog({ item, busy, onClose, onReject }: { item: Item | null; busy: boolean; onClose: () => void; onReject: (note?: string) => void }) {
  const [note, setNote] = useState("");
  const needsNote = item?.kind === "proof";
  return (
    <Dialog
      open={!!item}
      onOpenChange={(o) => {
        if (!o) {
          setNote("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this {item ? KIND[item.kind].toLowerCase() : "item"}?</DialogTitle>
          <DialogDescription>
            {item?.kind === "proof"
              ? "The creator sees your reason and uploads a new screenshot."
              : item?.kind === "plan"
                ? "The plan stays on record as rejected. The planner can pitch a new variant."
                : item?.kind === "billing"
                  ? "Finance won't pay into these bank details until the creator fixes and resubmits them."
                  : item?.kind === "page-edit"
                    ? "The suggested changes are discarded and the page stays as it is."
                    : "The page can't be booked until it's added again."}
          </DialogDescription>
        </DialogHeader>
        {needsNote && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="reject-note">Reason for the creator</Label>
            <Input id="reject-note" placeholder="e.g. Screenshot is cut off. Show the full post." value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={busy || (needsNote && !note.trim())}
            onClick={() => {
              onReject(needsNote ? note.trim() : undefined);
              setNote("");
            }}
          >
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
