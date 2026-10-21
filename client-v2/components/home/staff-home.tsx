"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CircleCheck,
  ClipboardCheck,
  FileSpreadsheet,
  IdCard,
  Landmark,
  ListChecks,
  Plus,
  ReceiptText,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import {
  canUse,
  hasAccess,
  invoices as invoicesApi,
  links as linksApi,
  type Campaign,
  type PageOwner,
} from "@/lib/api-client";
import { deadlineLabel, isEnded, POST_STATUS } from "@/lib/campaigns";
import {
  buildVendorRows,
  captionTitle,
  formatLabel,
  latestSnapshot,
  monthKeyOf,
  monthLabel,
  monthRange,
} from "@/lib/finance";
import { personLabel, plural } from "@/lib/format";
import {
  canApprovePlan,
  canEditPlan,
  isDecidable,
  PLAN_STATUS,
  planValue,
} from "@/lib/plans";
import { approvalCounts, useApprovalSources } from "@/lib/queries/approvals";
import { useCampaigns } from "@/lib/queries/campaigns";
import {
  useAssets,
  useDraftPayouts,
  usePaidLedger,
  usePaymentSummary,
  usePendingDues,
} from "@/lib/queries/finance";
import { usePlans } from "@/lib/queries/plans";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Illustration,
  type IllustrationName,
} from "@/components/taggify/illustration";
import { Money } from "@/components/taggify/money";
import { StatusPill } from "@/components/taggify/status-pill";
import { UserAvatar } from "@/components/taggify/user-avatar";
import { ContentThumb, displayHandle } from "@/components/finance/identity";

type Attention = {
  key: string;
  icon: LucideIcon;
  count: number;
  label: string;
  href: string;
};

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/**
 * Home for Admin, Finance and Planner (spec §6): what needs a decision first,
 * then live work, then money. Every section is gated on the permission its
 * data needs, so a Finance user granted extra keys sees those sections too
 * and nobody gets a card the server would refuse to fill.
 */
export function StaffHome() {
  const { user } = useAuth();
  const role = user?.role;
  const sources = useApprovalSources();
  const counts = approvalCounts(sources);
  const plans = usePlans();
  const drafts = useDraftPayouts();
  const { accessToken } = useAuth();
  // Creator invoices to decide: only for whoever can approve them (POST /invoices/:id/approve is finance.approve).
  const canApproveInvoices = hasAccess(user, "finance.approve");
  const raised = useQuery({
    queryKey: ["invoices", "home", "raised"],
    queryFn: () => invoicesApi.list(accessToken!, { status: "RAISED", pageSize: 1 }),
    enabled: !!accessToken && canApproveInvoices,
  });
  const canPay = hasAccess(user, "finance.pay");
  const canPlan = canEditPlan(user);
  const isPlanner = role === "PLAN_MAKER";

  // A planner decides their own drafts from the plan page; the inbox counts only global approvers.
  const myDecidable =
    isPlanner && canApprovePlan(user)
      ? (plans.data ?? []).filter(isDecidable).length
      : 0;
  const myRejected = isPlanner
    ? (plans.data ?? []).filter((p) => p.status === "REJECTED").length
    : 0;

  const attention: Attention[] = [
    {
      key: "proof",
      icon: CircleCheck,
      count: counts.proof,
      label: counts.proof === 1 ? "Proof to review" : "Proofs to review",
      href: "/approvals?type=proof",
    },
    {
      key: "insights",
      icon: TrendingUp,
      count: counts.insights,
      label: "Insights to verify",
      href: "/approvals?type=insights",
    },
    {
      key: "plan",
      icon: ClipboardCheck,
      count: counts.plan,
      label:
        counts.plan === 1
          ? "Plan awaiting approval"
          : "Plans awaiting approval",
      href: "/approvals?type=plan",
    },
    {
      key: "my-plan",
      icon: ClipboardCheck,
      count: myDecidable,
      label:
        myDecidable === 1 ? "Your plan to approve" : "Your plans to approve",
      href: "/plans",
    },
    {
      key: "rejected",
      icon: ClipboardCheck,
      count: myRejected,
      label:
        myRejected === 1
          ? "Rejected plan to revise"
          : "Rejected plans to revise",
      href: "/plans",
    },
    {
      key: "people",
      icon: FileSpreadsheet,
      count: counts.people,
      label:
        counts.people === 1
          ? "Campaign with pages to match"
          : "Campaigns with pages to match",
      href: "/approvals?type=people",
    },
    {
      key: "page",
      icon: IdCard,
      count: counts.page + counts["page-edit"],
      label: counts.page + counts["page-edit"] === 1 ? "Page to approve" : "Pages to approve",
      href: "/approvals?type=page",
    },
    {
      key: "billing",
      icon: Landmark,
      count: counts.billing,
      label: "Bank details to check",
      href: "/approvals?type=billing",
    },
    {
      key: "invoices",
      icon: ReceiptText,
      count: canApproveInvoices ? (raised.data?.total ?? 0) : 0,
      label: (raised.data?.total ?? 0) === 1 ? "Creator invoice to approve" : "Creator invoices to approve",
      href: "/finance/invoices",
    },
    {
      key: "drafts",
      icon: ReceiptText,
      count: canPay ? (drafts.data?.total ?? 0) : 0,
      label:
        (drafts.data?.total ?? 0) === 1
          ? "Payout waiting for its receipt"
          : "Payouts waiting for receipts",
      href: "/finance/payouts",
    },
  ].filter((a) => a.count > 0);
  const attentionSources = [
    sources.linksQ,
    sources.plansQ,
    sources.assetsQ,
    sources.billingQ,
    sources.campaignsQ,
    sources.proofTotal,
    sources.insightsTotal,
    plans,
    drafts,
    raised,
  ];
  const attentionLoading = attentionSources.some((q) => q.isLoading);
  // A failed source must never read as "all clear".
  const attentionFailed = attentionSources.some((q) => q.isError);

  const illustration: IllustrationName =
    role === "FINANCE" ? "finance-01" : isPlanner ? "planner-01" : "admin-01";
  const anyApprovals =
    sources.can.links ||
    sources.can.plans ||
    sources.can.pages ||
    sources.can.billing;

  return (
    <div className="flex flex-col gap-6 pt-2">
      <Card className="flex items-center gap-4 overflow-hidden p-5 md:p-6">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <p className="text-body text-muted-foreground">
              {greeting()}, {personLabel(user, "there").split(" ")[0]}
            </p>
            <h1 className="text-display">
              {attentionLoading || attentionFailed
                ? "Here's your day"
                : attention.length
                  ? "Here's what needs you today"
                  : "Nothing needs you right now"}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {anyApprovals && (
              <Button asChild>
                <Link href="/approvals">Open approvals</Link>
              </Button>
            )}
            {canPay && (
              <Button asChild variant={anyApprovals ? "outline" : "default"}>
                <Link href="/finance/payouts">Pay vendors</Link>
              </Button>
            )}
            {canPlan && (
              <Button asChild variant="outline">
                <Link href="/plans/new">
                  <Plus />
                  New plan
                </Link>
              </Button>
            )}
          </div>
        </div>
        <Illustration
          name={illustration}
          className="hidden h-36 w-auto sm:block"
        />
      </Card>

      <section aria-labelledby="attn-title" className="flex flex-col gap-3">
        <h2 id="attn-title" className="text-section">
          Needs your decision
        </h2>
        {attentionFailed && attention.length > 0 && (
          <p role="alert" className="-mt-1 text-small text-danger-helper">
            Some of this couldn&apos;t load, so the list may be incomplete.
            Refresh to try again.
          </p>
        )}
        {attentionLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-card" />
            ))}
          </div>
        ) : attentionFailed && attention.length === 0 ? (
          <Card role="alert" className="p-4 text-body text-danger-helper">
            Couldn&apos;t check what needs you. Refresh the page to try again.
          </Card>
        ) : attention.length === 0 ? (
          <Card className="flex items-center gap-3 p-4 text-body text-muted-foreground">
            <CircleCheck className="h-5 w-5 text-success-strong" aria-hidden />
            All clear. New proofs, plans and payouts show up here when they need
            you.
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {attention.map((a) => (
              <li key={a.key}>
                <Link
                  href={a.href}
                  className="flex items-center gap-3 rounded-card border bg-card p-4 text-foreground shadow-2 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring-soft"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-tile-coral-icon text-tile-coral-fg">
                    <a.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="num block text-section">{a.count}</span>
                    <span className="block text-small text-fg-muted">
                      {a.label}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-fg-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        {canUse(user, "campaigns.view") && (
          <ActiveCampaigns planner={isPlanner} />
        )}
        {canPay && <VendorsToPay />}
        {isPlanner && canUse(user, "plans.view") && <MyPlans />}
        {hasAccess(user, "links.view") && <RecentContent />}
        {canPay && <MonthSummary />}
      </div>
    </div>
  );
}

export function SectionCard({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  const id = `home-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b px-5 py-4">
          <h2 id={id} className="text-card-title">
            {title}
          </h2>
          {href && (
            <Link
              href={href}
              className="ml-auto text-small font-semibold text-brand-ink hover:underline"
            >
              {linkLabel}
            </Link>
          )}
        </div>
        {children}
      </Card>
    </section>
  );
}

export function Rows({
  loading,
  error,
  empty,
  children,
}: {
  loading: boolean;
  error: boolean;
  empty: string | null;
  children: React.ReactNode;
}) {
  if (loading)
    return (
      <div className="flex flex-col gap-2 p-5">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  if (error)
    return (
      <p className="px-5 py-6 text-small text-danger-helper">
        Couldn&apos;t load this. Refresh the page to try again.
      </p>
    );
  if (empty)
    return (
      <p className="px-5 py-6 text-small text-muted-foreground">{empty}</p>
    );
  return <ul className="divide-y">{children}</ul>;
}

function CampaignBadge({ c }: { c: Campaign }) {
  return c.representativePost?.thumbnailUrl ? (
    <ContentThumb src={c.representativePost.thumbnailUrl} format="reel" />
  ) : (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-brand-soft text-label font-bold text-brand-ink">
      {c.brandName
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()}
    </span>
  );
}

/** Live campaigns, soonest deadline first, with the one status that matters. */
function ActiveCampaigns({ planner }: { planner: boolean }) {
  const campaigns = useCampaigns();
  const live = useMemo(
    () =>
      (campaigns.data ?? [])
        .filter((c) => !isEnded(c))
        .sort(
          (a, b) =>
            (a.deadline ? new Date(a.deadline).getTime() : Infinity) -
            (b.deadline ? new Date(b.deadline).getTime() : Infinity),
        ),
    [campaigns.data],
  );
  return (
    <SectionCard
      title={planner ? "Your campaigns" : "Active campaigns"}
      href="/campaigns"
      linkLabel={live.length > 5 ? `View all ${live.length}` : "View all"}
    >
      <Rows
        loading={campaigns.isLoading}
        error={campaigns.isError}
        empty={
          live.length
            ? null
            : "No live campaigns. Approving a plan creates one."
        }
      >
        {live.slice(0, 5).map((c) => {
          const cap = c.costCap ? Number(c.costCap) : null;
          const spent = c.spent ?? 0;
          const status =
            (c.pendingAssignmentCount ?? 0) > 0 ? (
              <StatusPill tone="warning">
                {plural(c.pendingAssignmentCount ?? 0, "page")} to match
              </StatusPill>
            ) : cap && spent > cap ? (
              <StatusPill tone="danger">Over budget</StatusPill>
            ) : (
              <StatusPill tone="success">On track</StatusPill>
            );
          return (
            <li key={c.id}>
              <Link
                href={`/campaigns/${c.id}`}
                className="flex items-center gap-3 px-5 py-3 text-foreground hover:bg-accent hover:text-foreground"
              >
                <CampaignBadge c={c} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-strong">
                    {c.title}
                  </span>
                  <span className="block truncate text-small text-fg-muted">
                    {c.brandName} · {plural(c.postCount ?? 0, "post")} ·{" "}
                    {deadlineLabel(c)}
                  </span>
                </span>
                <span className="shrink-0">{status}</span>
              </Link>
            </li>
          );
        })}
      </Rows>
    </SectionCard>
  );
}

/** Vendors owed the most, straight into their payout page. */
export function VendorsToPay() {
  const month = monthKeyOf(new Date());
  const pending = usePendingDues();
  const assets = useAssets();
  const rows = useMemo(() => {
    if (!pending.data) return [];
    return buildVendorRows({
      links: pending.data.items,
      invoices: pending.data.invoices,
      assets: assets.data ?? [],
      paidThisMonth: new Map<
        string,
        { amount: number; owner: PageOwner | null }
      >(),
      month,
    })
      .filter((r) => r.totalDue > 0)
      .sort((a, b) => b.totalDue - a.totalDue);
  }, [pending.data, assets.data, month]);
  return (
    <SectionCard
      title="Vendors to pay"
      href="/finance/payouts"
      linkLabel={rows.length > 5 ? `All ${rows.length} vendors` : "All vendors"}
    >
      <Rows
        loading={pending.isLoading}
        error={pending.isError}
        empty={rows.length ? null : "Nobody is owed anything right now."}
      >
        {rows.slice(0, 5).map((r) => (
          <li key={r.id}>
            <Link
              href={`/finance/payouts/${r.id}`}
              className="flex items-center gap-3 px-5 py-3 text-foreground hover:bg-accent hover:text-foreground"
            >
              <UserAvatar name={personLabel(r.owner, "Vendor")} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-strong">
                  {personLabel(r.owner, "Unnamed vendor")}
                </span>
                <span className="block truncate text-small text-fg-muted">
                  {plural(r.pages.length || 1, "page")} ·{" "}
                  {plural(r.links.length, "post")}
                  {r.invoices.length
                    ? ` · ${plural(r.invoices.length, "invoice")}`
                    : ""}
                </span>
              </span>
              <Money value={r.totalDue} className="font-semibold" />
              <ArrowRight className="h-4 w-4 text-fg-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </Rows>
    </SectionCard>
  );
}

/** A planner's own plans, newest change first. */
function MyPlans() {
  const plans = usePlans();
  const rows = useMemo(
    () =>
      [...(plans.data ?? [])].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [plans.data],
  );
  return (
    <SectionCard title="Your plans" href="/plans" linkLabel="All plans">
      <Rows
        loading={plans.isLoading}
        error={plans.isError}
        empty={rows.length ? null : "No plans yet. Start one with New plan."}
      >
        {rows.slice(0, 5).map((p) => (
          <li key={p.id}>
            <Link
              href={`/plans/${p.id}`}
              className="flex items-center gap-3 px-5 py-3 text-foreground hover:bg-accent hover:text-foreground"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-tile-amber-icon text-tile-amber-fg">
                <ListChecks className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-strong">
                  {p.name} ({p.variantLabel})
                </span>
                <span className="block truncate text-small text-fg-muted">
                  {p.clientName} · <Money value={planValue(p)} />
                </span>
              </span>
              <span className="shrink-0">
                <StatusPill tone={PLAN_STATUS[p.status].tone}>
                  {PLAN_STATUS[p.status].label}
                </StatusPill>
              </span>
            </Link>
          </li>
        ))}
      </Rows>
    </SectionCard>
  );
}

/** Newest posts across every campaign. */
function RecentContent() {
  const { accessToken, user } = useAuth();
  // Without campaigns.view the campaign page would refuse; open the post itself instead.
  const toCampaign = canUse(user, "campaigns.view");
  const recent = useQuery({
    queryKey: ["links", "recent"],
    queryFn: () => linksApi.list(accessToken!, { page: 1, pageSize: 6 }),
    enabled: !!accessToken,
  });
  const items = recent.data?.items ?? [];
  return (
    <SectionCard title="Recent content">
      <Rows
        loading={recent.isLoading}
        error={recent.isError}
        empty={items.length ? null : "No posts yet."}
      >
        {items.map((l) => {
          const snap = latestSnapshot(l);
          const st = POST_STATUS[l.status];
          return (
            <li key={l.id}>
              <Link
                href={toCampaign ? `/campaigns/${l.campaignId}` : l.url}
                {...(toCampaign ? {} : { target: "_blank", rel: "noreferrer" })}
                className="flex items-center gap-3 px-5 py-3 text-foreground hover:bg-accent hover:text-foreground"
              >
                <ContentThumb src={snap?.thumbnailUrl} format={l.format} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-strong">
                    {captionTitle(snap?.caption) ?? formatLabel(l.format)}
                  </span>
                  <span className="block truncate text-small text-fg-muted">
                    {displayHandle(l.asset?.handle ?? "—", l.asset?.platform)} ·{" "}
                    {l.campaign?.title ?? "—"}
                  </span>
                </span>
                <span className="shrink-0">
                  <StatusPill tone={st.tone}>{st.label}</StatusPill>
                </span>
              </Link>
            </li>
          );
        })}
      </Rows>
    </SectionCard>
  );
}

/** Three numbers for the month — a summary, not a KPI wall. */
function MonthSummary() {
  const month = monthKeyOf(new Date());
  const all = usePaymentSummary({});
  const thisMonth = usePaymentSummary(monthRange(month));
  const paid = usePaidLedger(monthRange(month));
  const loading = all.isLoading || thisMonth.isLoading || paid.isLoading;
  const rows: [string, React.ReactNode, string][] = [
    [
      "Owed to creators",
      <Money key="o" value={all.data?.pending.amount ?? 0} />,
      `${plural(all.data?.pending.links ?? 0, "post")}${all.data?.pending.invoices ? ` · ${plural(all.data.pending.invoices, "invoice")}` : ""} · includes unfinished payouts`,
    ],
    [
      `Paid in ${monthLabel(month)}`,
      <Money key="p" value={thisMonth.data?.paid.amount ?? 0} />,
      `${plural(thisMonth.data?.paid.payments ?? 0, "payment")} · net of TDS`,
    ],
    [
      "Latest payout",
      paid.data?.items[0] ? (
        <Money
          key="l"
          value={
            paid.data.items[0].kind === "payout"
              ? paid.data.items[0].payout.netAmount
              : paid.data.items[0].invoice.amount
          }
        />
      ) : (
        "—"
      ),
      paid.data?.items[0]?.paidAt
        ? new Date(paid.data.items[0].paidAt).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
          })
        : "None this month",
    ],
  ];
  return (
    <SectionCard
      title="Money this month"
      href="/finance/payouts"
      linkLabel="Payouts"
    >
      {loading ? (
        <div className="p-5">
          <Skeleton className="h-24" />
        </div>
      ) : all.isError || thisMonth.isError || paid.isError ? (
        <p className="px-5 py-6 text-small text-danger-helper">
          Couldn&apos;t load this. Refresh the page to try again.
        </p>
      ) : (
        <dl className="divide-y">
          {rows.map(([label, value, meta]) => (
            <div key={label} className="flex items-center gap-3 px-5 py-3">
              <dt className="min-w-0 flex-1">
                <span className="block text-body">{label}</span>
                <span className="block text-small text-fg-muted">{meta}</span>
              </dt>
              <dd className="text-card-title">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </SectionCard>
  );
}
