"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Chip, Chips, Segmented } from "@/components/ui/chips";
import { Card, Table, THead, TH, TR, TD, Cell2 } from "@/components/ui/data-table";
import { Tag, type TagTone } from "@/components/ui/tag";
import { Sheet } from "@/components/ui/sheet";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { LinkDetailPanel } from "@/components/dashboard/link-detail-panel";
import { ChevronRightIcon, CheckIcon, ArrowRightIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { FORMATS, formatLabel, joinLabels } from "@/lib/formats";
import { RateFields, missingRequiredRates, rateCardsFrom, type RateDraft } from "@/components/inventory/rate-fields";
import { FieldError } from "@/components/ui/form-field";
import { ComboInput } from "@/components/ui/combo-input";
import { links as linksApi, assets as assetsApi, billing as billingApi, plans as plansApi, campaigns as campaignsApi, hasAccess, ApiError, type Link as LinkRow, type Plan, type Asset, type BillingProfile, type Campaign } from "@/lib/api-client";
import { money, initialsOf, roleLabel, personLabel, followersLabel } from "@/lib/format";

const DAY = 24 * 60 * 60 * 1000;
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
const waitTag = (days: number): TagTone => (days >= 3 ? "bad" : days >= 1 ? "wait" : "neutral");

type Kind = "screenshot" | "insights" | "plan" | "people" | "page" | "page-edit" | "billing";
const KIND_LABEL: Record<Kind, string> = { screenshot: "Screenshot", insights: "Insights", plan: "Plan", people: "New people", page: "New page", "page-edit": "Page edit", billing: "Billing profile" };

type Item =
  | { kind: "screenshot" | "insights"; id: string; title: string; campaign: string; since: string; link: LinkRow }
  | { kind: "plan"; id: string; title: string; campaign: string; since: string; plan: Plan }
  | { kind: "people"; id: string; title: string; campaign: string; since: string; campaignRow: Campaign }
  | { kind: "page"; id: string; title: string; campaign: string; since: string; asset: Asset }
  // A planner's suggested edit to an existing page (16 Oct) — apply or discard.
  | { kind: "page-edit"; id: string; title: string; campaign: string; since: string; asset: Asset }
  | { kind: "billing"; id: string; title: string; campaign: string; since: string; profile: BillingProfile };

export default function ApprovalsPage() {
  return (
    <RequireAuth>
      <Suspense>
        <ApprovalsContent />
      </Suspense>
    </RequireAuth>
  );
}

/**
 * The approvals queue (premium mockup 03): work it top to bottom, each row
 * is one decision. List on the left, one item on the right, "Approve &
 * next" keeps the admin in flow. Covers screenshot proofs, insights, plans,
 * new people from imported sheets, new pages and billing profiles.
 */
function ApprovalsContent() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const token = accessToken!;
  // Approvals bundles four independent decisions (23 Sep) — each one is its
  // own permission key, not one bare ADMIN flag, so a role granted just one
  // of them (e.g. Finance given inventory.approve) gets a working queue for
  // that kind instead of a page it can look at but never act on.
  const canReviewLinks = hasAccess(user, "links.approve");
  const canApprovePlans = hasAccess(user, "plans.approve");
  const canApprovePages = hasAccess(user, "inventory.approve");
  const canApproveBilling = hasAccess(user, "finance.pay");
  // Fixing a page's rates / category is Inventory's edit grant (PUT /assets/:id/rate-card, /details).
  const canEditPages = hasAccess(user, "inventory.edit");

  const [filter, setFilter] = useState<"all" | Kind>(() => {
    // The admin home's pipeline chart links here with the link status.
    const st = params.get("status");
    return st === "PENDING_SCREENSHOT_REVIEW" ? "screenshot" : st === "INSIGHTS_PENDING" ? "insights" : "all";
  });
  const [sort, setSort] = useState<"oldest" | "newest" | "campaign">("oldest");
  const [selectedId, setSelectedId] = useState<string | null>(params.get("item"));
  const [mobileOpen, setMobileOpen] = useState(false);

  const linksQuery = useQuery({ queryKey: ["links", "approvals"], queryFn: () => linksApi.list(token, { status: "PENDING_SCREENSHOT_REVIEW,INSIGHTS_PENDING", pageSize: 100 }) });
  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: () => plansApi.list(token), enabled: canApprovePlans });
  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token) });
  const billingQuery = useQuery({ queryKey: ["billingProfiles"], queryFn: () => billingApi.list(token) });
  const campaignsQuery = useQuery({ queryKey: ["campaigns"], queryFn: () => campaignsApi.list(token) });

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const l of linksQuery.data?.items ?? []) {
      out.push({ kind: l.status === "PENDING_SCREENSHOT_REVIEW" ? "screenshot" : "insights", id: l.id, title: `@${l.asset?.handle ?? "—"} · ${formatLabel(l.format)}`, campaign: l.campaign?.title ?? "—", since: l.createdAt, link: l });
    }
    for (const p of (plansQuery.data ?? []).filter((p) => p.status === "PENDING_APPROVAL")) {
      out.push({ kind: "plan", id: p.id, title: p.name, campaign: p.clientName, since: p.updatedAt, plan: p });
    }
    for (const c of (campaignsQuery.data ?? []).filter((c) => (c.pendingAssignmentCount ?? 0) > 0)) {
      out.push({ kind: "people", id: `people-${c.id}`, title: `${c.pendingAssignmentCount} creators from sheet`, campaign: c.title, since: c.createdAt, campaignRow: c });
    }
    for (const a of (assetsQuery.data ?? []).filter((a) => a.approvalStatus === "pending")) {
      out.push({ kind: "page", id: a.id, title: `@${a.handle}`, campaign: a.category ?? "—", since: a.createdAt, asset: a });
    }
    for (const a of (assetsQuery.data ?? []).filter((a) => a.pendingEdit && typeof a.pendingEdit === "object")) {
      out.push({ kind: "page-edit", id: `edit-${a.id}`, title: `@${a.handle} · suggested edit`, campaign: a.pendingEditBy?.name ?? a.pendingEditBy?.email ?? "Planner", since: a.pendingEditAt ?? a.createdAt, asset: a });
    }
    for (const b of (billingQuery.data ?? []).filter((b) => b.approvalStatus === "pending")) {
      out.push({ kind: "billing", id: b.id, title: b.name, campaign: b.user?.name ?? "—", since: b.createdAt ?? new Date().toISOString(), profile: b });
    }
    return out;
  }, [linksQuery.data, plansQuery.data, campaignsQuery.data, assetsQuery.data, billingQuery.data]);

  const pageCategories = useMemo(() => [...new Set((assetsQuery.data ?? []).map((a) => a.category?.trim()).filter((c): c is string => !!c))].sort((x, y) => x.localeCompare(y)), [assetsQuery.data]);

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { screenshot: 0, insights: 0, plan: 0, people: 0, page: 0, "page-edit": 0, billing: 0 };
    for (const i of items) c[i.kind] += 1;
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const rows = filter === "all" ? items : items.filter((i) => i.kind === filter);
    return [...rows].sort((a, b) => {
      if (sort === "campaign") return a.campaign.localeCompare(b.campaign);
      const d = new Date(a.since).getTime() - new Date(b.since).getTime();
      return sort === "oldest" ? d : -d;
    });
  }, [items, filter, sort]);

  const selected = visible.find((i) => i.id === selectedId) ?? visible[0];
  const selectNext = () => {
    const idx = visible.findIndex((i) => i.id === selected?.id);
    const next = visible[idx + 1] ?? visible[0];
    setSelectedId(next && next.id !== selected?.id ? next.id : null);
  };
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["links"] });
    queryClient.invalidateQueries({ queryKey: ["plans"] });
    queryClient.invalidateQueries({ queryKey: ["assets"] });
    queryClient.invalidateQueries({ queryKey: ["billingProfiles"] });
    queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    selectNext();
  };

  const planDecision = useMutation({ mutationFn: ({ id, approve }: { id: string; approve: boolean }) => (approve ? plansApi.approve(token, id) : plansApi.reject(token, id)), onSuccess: refresh });
  const assetDecision = useMutation({ mutationFn: ({ id, approve }: { id: string; approve: boolean }) => assetsApi.setApproval(token, id, approve ? "approved" : "rejected"), onSuccess: refresh });
  const editDecision = useMutation({ mutationFn: ({ id, approve }: { id: string; approve: boolean }) => assetsApi.decideEdit(token, id, approve ? "approve" : "reject"), onSuccess: refresh });
  const billingDecision = useMutation({ mutationFn: ({ id, approve }: { id: string; approve: boolean }) => billingApi.setApproval(token, id, approve ? "approved" : "rejected"), onSuccess: refresh });

  const loading = linksQuery.isLoading || assetsQuery.isLoading || campaignsQuery.isLoading;
  const chips: { key: "all" | Kind; label: string; count: number }[] = [
    { key: "all", label: "All", count: items.length },
    { key: "screenshot", label: "Screenshots", count: counts.screenshot },
    { key: "insights", label: "Insights", count: counts.insights },
    { key: "plan", label: "Plans", count: counts.plan },
    { key: "people", label: "New people", count: counts.people },
    { key: "page", label: "New pages", count: counts.page },
    { key: "page-edit", label: "Page edits", count: counts["page-edit"] },
    { key: "billing", label: "Billing", count: counts.billing },
  ];

  const canDecide =
    selected?.kind === "plan" ? canApprovePlans : selected?.kind === "page" || selected?.kind === "page-edit" ? canApprovePages : selected?.kind === "billing" ? canApproveBilling : false;

  const detail = selected && (
    <DetailPanel
      item={selected}
      token={token}
      canReviewLinks={canReviewLinks}
      canDecide={canDecide}
      onChanged={refresh}
      onDecide={(approve) => {
        if (selected.kind === "plan") planDecision.mutate({ id: selected.id, approve });
        else if (selected.kind === "page") assetDecision.mutate({ id: selected.id, approve });
        else if (selected.kind === "page-edit") editDecision.mutate({ id: selected.asset.id, approve });
        else if (selected.kind === "billing") billingDecision.mutate({ id: selected.id, approve });
      }}
      pending={planDecision.isPending || assetDecision.isPending || editDecision.isPending || billingDecision.isPending}
      // A refused decision (e.g. RATES_REQUIRED — a page can't be approved
      // without its Reel and Story rates) is shown on the
      // item it was about, in the server's own words.
      error={(selected.kind === "page-edit" ? [editDecision] : [planDecision, assetDecision, billingDecision])
        .filter((m) => m.isError && m.variables?.id === (selected.kind === "page-edit" ? selected.asset.id : selected.id))
        .map((m) => (m.error instanceof ApiError ? m.error.message : "Couldn't save that decision."))[0] ?? null}
      onOpenCampaign={(id) => router.push(`/campaigns/view?id=${id}`)}
      canEditPage={canEditPages}
      categories={pageCategories}
      // A fresh panel per item, so an open editor doesn't carry over to the next page.
      key={selected.id}
    />
  );

  return (
    <AppShell active="approvals" user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }} searchPlaceholder="Search approvals…">
      <div className="flex flex-col gap-5">
        <PageHeader
          title="Approvals"
          subtitle="Work the queue top to bottom. Each row is one decision."
          actions={
            <Segmented
              ariaLabel="Sort approvals"
              value={sort}
              onChange={setSort}
              options={[
                { value: "oldest", label: "Oldest first" },
                { value: "newest", label: "Newest" },
                { value: "campaign", label: "By campaign" },
              ]}
            />
          }
        />

        <Chips>
          {chips
            .filter((c) => c.key === "all" || c.count > 0 || filter === c.key)
            .map((c) => (
              <Chip key={c.key} on={filter === c.key} count={c.count} onClick={() => setFilter(c.key)} testId={`approvals-chip-${c.key}`}>
                {c.label}
              </Chip>
            ))}
        </Chips>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_460px]">
          <Card>
            {loading ? (
              <TableSkeleton />
            ) : visible.length === 0 ? (
              <EmptyState label="Nothing waiting on you — all caught up." />
            ) : (
              <Table data-testid="approvals-table">
                <THead>
                  <tr>
                    <TH>Item</TH>
                    <TH className="hidden md:table-cell">Campaign</TH>
                    <TH>Waiting</TH>
                    <TH />
                  </tr>
                </THead>
                <tbody>
                  {visible.map((i) => {
                    const days = daysSince(i.since);
                    const isSel = selected?.id === i.id;
                    return (
                      <TR
                        key={i.id}
                        interactive
                        selected={isSel}
                        onClick={() => {
                          setSelectedId(i.id);
                          setMobileOpen(true);
                        }}
                        data-testid={`approval-row-${i.id}`}
                      >
                        <TD>
                          <Cell2 primary={i.title} secondary={KIND_LABEL[i.kind]} />
                        </TD>
                        <TD className="hidden md:table-cell">{i.campaign}</TD>
                        <TD>
                          <Tag tone={waitTag(days)}>{days === 0 ? "Today" : `${days}d`}</Tag>
                        </TD>
                        <TD right>
                          <ChevronRightIcon className="h-4 w-4 text-text-faint" />
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          <div className="hidden lg:block">{detail ?? <Card className="p-8 text-center text-[0.8125rem] text-text-muted">Select a row to review it.</Card>}</div>
        </div>

        {mobileOpen && selected && (
          <Sheet onClose={() => setMobileOpen(false)} overlayClassName="lg:hidden" panelClassName="lg:hidden">
            <div className="overflow-y-auto p-5 pt-1">{detail}</div>
          </Sheet>
        )}
      </div>
    </AppShell>
  );
}

function DetailPanel({
  item,
  token,
  canReviewLinks,
  canDecide,
  onChanged,
  onDecide,
  pending,
  error,
  onOpenCampaign,
  canEditPage,
  categories,
}: {
  item: Item;
  token: string;
  canReviewLinks: boolean;
  /** Can fix a pending page's rates and category in place (inventory.edit — same as Inventory's Edit). */
  canEditPage: boolean;
  /** Categories already used on pages, suggested in the category box. */
  categories: string[];
  /** Reject/Approve footer for plan/page/billing kinds — the one action that item's own permission key allows. */
  canDecide: boolean;
  onChanged: () => void;
  onDecide: (approve: boolean) => void;
  pending: boolean;
  error: string | null;
  onOpenCampaign: (id: string) => void;
}) {
  const days = daysSince(item.since);
  const [editingPage, setEditingPage] = useState(false);
  const header = (title: string, sub: string) => (
    <div className="flex items-start gap-3 border-b border-border px-[18px] py-[13px]">
      <div className="min-w-0">
        <h3 className="truncate text-[0.875rem] font-semibold">{title}</h3>
        <p className="text-[0.78rem] text-text-muted">{sub}</p>
      </div>
      <Tag tone={waitTag(days)} className="ml-auto">
        Waiting {days === 0 ? "today" : `${days}d`}
      </Tag>
    </div>
  );
  const footer = canDecide ? (
    <div className="mt-auto flex flex-col gap-2.5 border-t border-border px-[18px] py-3.5">
      {error && <ErrorNotice message={error} />}
      <div className="flex items-center gap-2">
        <Button variant="danger" onClick={() => onDecide(false)} disabled={pending}>
          Reject
        </Button>
        <Button className="ml-auto" onClick={() => onDecide(true)} disabled={pending} data-testid="approve-next">
          <CheckIcon className="h-4 w-4" />
          Approve &amp; next
        </Button>
      </div>
    </div>
  ) : (
    <p className="border-t border-border px-[18px] py-3.5 text-[0.78rem] text-text-muted">You can see this, but approving it needs a different access grant.</p>
  );

  if (item.kind === "screenshot" || item.kind === "insights") {
    return (
      <Card className="flex flex-col" data-testid="approval-detail">
        {header(item.title, `${item.campaign} · ${money(item.link.cost)}`)}
        <div className="p-[18px]">
          <LinkDetailPanel link={item.link} token={token} isAdmin={canReviewLinks} canUploadScreenshot={false} onChanged={onChanged} />
        </div>
      </Card>
    );
  }
  if (item.kind === "plan") {
    const p = item.plan;
    return (
      <Card className="flex flex-col" data-testid="approval-detail">
        {header(p.name, `${p.clientName} · ${p.createdBy?.name ?? "Planner"}`)}
        <div className="flex flex-col gap-3 p-[18px]">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Pages" value={String(p.items?.length ?? 0)} />
            <Stat label="Quoted" value={money(p.overview?.total ?? 0)} />
            <Stat label="Budget" value={p.budget ? money(Number(p.budget)) : "—"} />
          </div>
          <div className="flex flex-col gap-1.5">
            {(p.items ?? []).slice(0, 6).map((it) => (
              <div key={it.id} className="flex items-center justify-between text-[0.8125rem]">
                <span className="font-medium">@{it.asset?.handle ?? "—"}</span>
                <span className="tabular-nums text-text-muted">
                  {formatLabel(it.format)} · {money(Number(it.clientCost ?? it.cost))}
                </span>
              </div>
            ))}
            {(p.items?.length ?? 0) > 6 && <span className="text-[0.78rem] text-text-muted">+{p.items.length - 6} more pages</span>}
          </div>
          <Link href={`/plans?id=${p.id}`} className="flex items-center gap-1 text-[0.8125rem] font-medium text-blue hover:text-text">
            Open full plan <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>
        {footer}
      </Card>
    );
  }
  if (item.kind === "page-edit") {
    const a = item.asset;
    const e = item.asset.pendingEdit ?? {};
    const rows: [string, string, string][] = [];
    if ("category" in e) rows.push(["Category", a.category ?? "—", e.category ?? "—"]);
    if ("grade" in e) rows.push(["Grade", a.grade ?? "—", e.grade ?? "—"]);
    if ("groupLink" in e) rows.push(["Group link", a.groupLink ?? "—", e.groupLink ?? "—"]);
    for (const rc of e.rateCards ?? []) {
      const current = a.rateCards.find((r) => r.format === rc.format);
      rows.push([`${formatLabel(rc.format)} rate`, current ? money(Number(current.amount)) : "—", money(rc.amount)]);
    }
    return (
      <Card className="flex flex-col" data-testid="approval-detail">
        {header(`@${a.handle}`, `Suggested by ${a.pendingEditBy?.name ?? a.pendingEditBy?.email ?? "a planner"} · ${a.category ?? "uncategorised"}`)}
        <div className="flex flex-col gap-3 p-[18px]">
          <p className="text-[0.8125rem] text-text-muted">Approve applies these changes to the page; reject discards them and leaves the page as it is.</p>
          <table className="w-full text-[0.8125rem]" data-testid="approval-edit-diff">
            <thead>
              <tr className="text-left text-[0.7rem] uppercase tracking-wide text-text-faint">
                <th className="py-1 pr-3 font-medium">Field</th>
                <th className="py-1 pr-3 font-medium">Now</th>
                <th className="py-1 font-medium">Suggested</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(([label, from, to]) => (
                <tr key={label}>
                  <td className="py-1.5 pr-3 text-text-muted">{label}</td>
                  <td className="py-1.5 pr-3 text-text-faint line-through">{from}</td>
                  <td className="py-1.5 font-semibold">{to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {footer}
      </Card>
    );
  }
  if (item.kind === "page") {
    const a = item.asset;
    // What's still blank on the page: the category. No rate is mandatory (16 Oct, later).
    const missing = a.category ? [] : ["category"];
    return (
      <Card className="flex flex-col" data-testid="approval-detail">
        {header(`@${a.handle}`, `${a.owner?.name ?? "—"} · ${a.category ?? "uncategorised"}`)}
        <div className="flex flex-col gap-3 p-[18px]">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Followers" value={followersLabel(a.followers)} />
            <Stat label="Added" value={new Date(a.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })} />
          </div>
          {editingPage ? (
            <PageDetailsEditor key={a.id} asset={a} token={token} categories={categories} onDone={() => setEditingPage(false)} />
          ) : (
            <>
              {/* The page's priced formats (14 Oct; all optional since 16 Oct). */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5" data-testid="approval-page-rates">
                {FORMATS.filter((f) => a.rateCards.some((r) => r.format === f && Number(r.amount) > 0)).map((f) => {
                  const rc = a.rateCards.find((r) => r.format === f);
                  return <Stat key={f} label={`${formatLabel(f)} rate`} value={rc ? money(Number(rc.amount)) : "—"} />;
                })}
                {!a.rateCards.some((r) => Number(r.amount) > 0) && <p className="col-span-full text-[0.78rem] text-text-faint">No rates yet.</p>}
              </div>
              {missing.length > 0 && (
                <div className="flex flex-col gap-2 rounded-md border border-dashed border-border-strong px-3 py-2.5" data-testid="approval-rates-needed">
                  <p className="text-[0.78rem] text-text">
                    <span className="font-semibold">Missing:</span> {missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}` : missing[0]}.
                  </p>
                  {canEditPage ? (
                    <Button size="sm" variant="secondary" className="self-start" onClick={() => setEditingPage(true)} data-testid="approval-edit-page">
                      Fill in missing details
                    </Button>
                  ) : (
                    <p className="text-[0.72rem] text-text-muted">Someone who can edit pages in Inventory needs to fill these in.</p>
                  )}
                </div>
              )}
              {missing.length === 0 && canEditPage && (
                <button type="button" onClick={() => setEditingPage(true)} className="self-start text-[0.78rem] font-medium text-blue hover:text-text" data-testid="approval-edit-page">
                  Edit rates or category
                </button>
              )}
            </>
          )}
        </div>
        {footer}
      </Card>
    );
  }
  if (item.kind === "billing") {
    const b = item.profile;
    return (
      <Card className="flex flex-col" data-testid="approval-detail">
        {header(b.name, `${personLabel(b.user, "—")} · PAN ${b.pan}`)}
        <div className="grid grid-cols-2 gap-2 p-[18px]">
          <Stat label="GSTIN" value={b.gstin ?? "—"} />
          <Stat label="Bank" value={`${b.bankAccountNumber} · ${b.ifscCode}`} />
        </div>
        {footer}
      </Card>
    );
  }
  if (item.kind !== "people") return null;
  const c = item.campaignRow;
  return (
    <Card className="flex flex-col" data-testid="approval-detail">
      {header(`${c.pendingAssignmentCount} creators not in database`, c.title)}
      <div className="flex flex-col gap-3 p-[18px] text-[0.8125rem] text-text-muted">
        <p>These rows came from the sheet attached to the campaign. Creating them makes accounts with passwords you can view and share.</p>
        <Button className="self-start" onClick={() => onOpenCampaign(c.id)}>
          Create all on campaign page <ArrowRightIcon className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

/**
 * Approvals → New page → "Fill in missing details" (16 Oct): the page's five
 * rates and its category, edited in place so a page with blanks can be
 * finished and approved without leaving the queue. Saves the same way as
 * Inventory's row editor (rate card, then details). A rate that's already set
 * can be changed but not cleared — the server keeps rate cards.
 */
function PageDetailsEditor({ asset, token, categories, onDone }: { asset: Asset; token: string; categories: string[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [rates, setRates] = useState<RateDraft>(() => Object.fromEntries(FORMATS.flatMap((f) => { const rc = asset.rateCards.find((r) => r.format === f); return rc && Number(rc.amount) > 0 ? [[f, String(rc.amount)]] : []; })));
  const savedFormats = FORMATS.filter((f) => asset.rateCards.some((rc) => rc.format === f && Number(rc.amount) > 0));
  const [category, setCategory] = useState(asset.category ?? "");
  const [tried, setTried] = useState(false);
  const missing = missingRequiredRates(rates);
  const cleared = FORMATS.filter((f) => asset.rateCards.some((rc) => rc.format === f) && !(Number(rates[f]) > 0));

  const save = useMutation({
    mutationFn: async () => {
      // Only rates that changed; the endpoint needs at least one entry.
      const changed = rateCardsFrom(rates).filter((rc) => Number(asset.rateCards.find((r) => r.format === rc.format)?.amount ?? 0) !== rc.amount);
      if (changed.length > 0) await assetsApi.updateRateCard(token, asset.id, changed);
      const nextCategory = category.trim() === "" ? null : category.trim();
      if (nextCategory !== (asset.category ?? null)) await assetsApi.updateDetails(token, asset.id, { category: nextCategory });
    },
    onSuccess: () => {
      // Refresh only the page list, so the queue stays on this page with its new details, ready to approve.
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      onDone();
    },
  });

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-3"
      data-testid="approval-page-editor"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (missing.length > 0 || cleared.length > 0 || save.isPending) return;
        save.mutate();
      }}
    >
      <RateFields rates={rates} onChange={setRates} required={false} showErrors={tried} compact idPrefix={`@${asset.handle} `} fixed={savedFormats} />
      {tried && cleared.length > 0 && <FieldError message={`A rate that's set can't be removed: put back the ${joinLabels(cleared)} rate.`} />}
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.72rem] font-medium text-text-muted">Category</span>
        <ComboInput aria-label={`@${asset.handle} category`} value={category} onChange={setCategory} suggestions={categories.map((c) => ({ key: c, label: c }))} placeholder="Search or type a new category…" />
      </div>
      {save.isError && <ErrorNotice message={save.error instanceof ApiError ? save.error.message : "Couldn't save these details."} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={save.isPending} data-testid="approval-page-save">
          {save.isPending ? "Saving…" : "Save details"}
        </Button>
      </div>
    </form>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
      <p className="text-[0.7rem] text-text-muted">{label}</p>
      <p className="truncate text-[0.8375rem] font-semibold tabular-nums">{value}</p>
    </div>
  );
}
