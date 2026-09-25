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
import { TableSkeleton, EmptyState } from "@/components/ui/table-parts";
import { LinkDetailPanel } from "@/components/dashboard/link-detail-panel";
import { ChevronRightIcon, CheckIcon, ArrowRightIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { links as linksApi, assets as assetsApi, billing as billingApi, plans as plansApi, campaigns as campaignsApi, hasAccess, type Link as LinkRow, type Plan, type Asset, type BillingProfile, type Campaign } from "@/lib/api-client";
import { money, count, initialsOf, roleLabel, personLabel } from "@/lib/format";

const DAY = 24 * 60 * 60 * 1000;
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
const waitTag = (days: number): TagTone => (days >= 3 ? "bad" : days >= 1 ? "wait" : "neutral");

type Kind = "screenshot" | "insights" | "plan" | "people" | "page" | "billing";
const KIND_LABEL: Record<Kind, string> = { screenshot: "Screenshot", insights: "Insights", plan: "Plan", people: "New people", page: "New page", billing: "Billing profile" };

type Item =
  | { kind: "screenshot" | "insights"; id: string; title: string; campaign: string; since: string; link: LinkRow }
  | { kind: "plan"; id: string; title: string; campaign: string; since: string; plan: Plan }
  | { kind: "people"; id: string; title: string; campaign: string; since: string; campaignRow: Campaign }
  | { kind: "page"; id: string; title: string; campaign: string; since: string; asset: Asset }
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
      out.push({ kind: l.status === "PENDING_SCREENSHOT_REVIEW" ? "screenshot" : "insights", id: l.id, title: `@${l.asset?.handle ?? "—"} · ${l.format}`, campaign: l.campaign?.title ?? "—", since: l.createdAt, link: l });
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
    for (const b of (billingQuery.data ?? []).filter((b) => b.approvalStatus === "pending")) {
      out.push({ kind: "billing", id: b.id, title: b.name, campaign: b.user?.name ?? "—", since: b.createdAt ?? new Date().toISOString(), profile: b });
    }
    return out;
  }, [linksQuery.data, plansQuery.data, campaignsQuery.data, assetsQuery.data, billingQuery.data]);

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { screenshot: 0, insights: 0, plan: 0, people: 0, page: 0, billing: 0 };
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
  const billingDecision = useMutation({ mutationFn: ({ id, approve }: { id: string; approve: boolean }) => billingApi.setApproval(token, id, approve ? "approved" : "rejected"), onSuccess: refresh });

  const loading = linksQuery.isLoading || assetsQuery.isLoading || campaignsQuery.isLoading;
  const chips: { key: "all" | Kind; label: string; count: number }[] = [
    { key: "all", label: "All", count: items.length },
    { key: "screenshot", label: "Screenshots", count: counts.screenshot },
    { key: "insights", label: "Insights", count: counts.insights },
    { key: "plan", label: "Plans", count: counts.plan },
    { key: "people", label: "New people", count: counts.people },
    { key: "page", label: "New pages", count: counts.page },
    { key: "billing", label: "Billing", count: counts.billing },
  ];

  const canDecide =
    selected?.kind === "plan" ? canApprovePlans : selected?.kind === "page" ? canApprovePages : selected?.kind === "billing" ? canApproveBilling : false;

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
        else if (selected.kind === "billing") billingDecision.mutate({ id: selected.id, approve });
      }}
      pending={planDecision.isPending || assetDecision.isPending || billingDecision.isPending}
      onOpenCampaign={(id) => router.push(`/campaigns/view?id=${id}`)}
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
  onOpenCampaign,
}: {
  item: Item;
  token: string;
  canReviewLinks: boolean;
  /** Reject/Approve footer for plan/page/billing kinds — the one action that item's own permission key allows. */
  canDecide: boolean;
  onChanged: () => void;
  onDecide: (approve: boolean) => void;
  pending: boolean;
  onOpenCampaign: (id: string) => void;
}) {
  const days = daysSince(item.since);
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
    <div className="mt-auto flex items-center gap-2 border-t border-border px-[18px] py-3.5">
      <Button variant="danger" onClick={() => onDecide(false)} disabled={pending}>
        Reject
      </Button>
      <Button className="ml-auto" onClick={() => onDecide(true)} disabled={pending} data-testid="approve-next">
        <CheckIcon className="h-4 w-4" />
        Approve &amp; next
      </Button>
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
                  {it.format} · {money(Number(it.clientCost ?? it.cost))}
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
  if (item.kind === "page") {
    const a = item.asset;
    return (
      <Card className="flex flex-col" data-testid="approval-detail">
        {header(`@${a.handle}`, `${a.owner?.name ?? "—"} · ${a.category ?? "uncategorised"}`)}
        <div className="grid grid-cols-3 gap-2 p-[18px]">
          <Stat label="Followers" value={count(a.followers)} />
          <Stat label="Reel rate" value={a.rateCards.find((r) => r.format === "reel") ? money(Number(a.rateCards.find((r) => r.format === "reel")!.amount)) : "—"} />
          <Stat label="Added" value={new Date(a.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })} />
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
      <p className="text-[0.7rem] text-text-muted">{label}</p>
      <p className="truncate text-[0.8375rem] font-semibold tabular-nums">{value}</p>
    </div>
  );
}
