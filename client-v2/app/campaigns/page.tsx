"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpDown, Plus } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { canUse, hasAccess, isOwnScopeRole, type Campaign } from "@/lib/api-client";
import { deadlineLabel, isEnded } from "@/lib/campaigns";
import { plural } from "@/lib/format";
import { useCampaigns } from "@/lib/queries/campaigns";
import { cn, openRow } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterSelect } from "@/components/taggify/filter-select";
import { EmptyState } from "@/components/taggify/illustration";
import { Money } from "@/components/taggify/money";
import { SpendMeter } from "@/components/taggify/progress-meter";
import { SearchField } from "@/components/taggify/search-field";
import { StatusPill } from "@/components/taggify/status-pill";
import { NewCampaignDialog } from "@/components/campaigns/new-campaign-dialog";
import { ContentThumb } from "@/components/finance/identity";
import { Pager, PER_PAGE } from "@/components/finance/pager";
import { LoadError, NoAccess } from "@/components/finance/states";

type Tab = "live" | "ended" | "all";

export default function CampaignsPage() {
  return (
    <AppShell active="campaigns">
      <Suspense>
        <Campaigns />
      </Suspense>
    </AppShell>
  );
}

/** One row per campaign group: phase 1 (or a standalone campaign) stands for its phases. */
const isRoot = (c: Campaign) => !c.parentCampaignId;

function Campaigns() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const list = useCampaigns();
  const [tab, setTab] = useState<Tab>("live");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("deadline");
  const [page, setPage] = useState(1);
  const creatorView = isOwnScopeRole(user?.role) && user?.role !== "PLAN_MAKER";
  // POST /campaigns needs the global campaigns.edit key; there is no own-content version of it.
  const canCreate = hasAccess(user, "campaigns.edit");
  // /campaigns?new=1 (v1's deep link) opens New campaign straight away.
  const [creating, setCreating] = useState(params.get("new") === "1");
  useEffect(() => {
    if (params.get("new") === "1") setCreating(true);
  }, [params]);

  if (!canUse(user, "campaigns.view")) return <NoAccess what="campaigns" />;

  const all = (list.data ?? []).filter((c) => (creatorView ? true : isRoot(c)));
  const counts = { live: all.filter((c) => !isEnded(c)).length, ended: all.filter((c) => isEnded(c)).length, all: all.length };
  const needle = q.trim().toLowerCase();
  const rows = all
    .filter((c) => tab === "all" || (tab === "ended" ? isEnded(c) : !isEnded(c)))
    .filter((c) => !needle || `${c.title} ${c.brandName}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (sort === "spend") return (b.spent ?? 0) - (a.spent ?? 0);
      if (sort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return (a.deadline ? new Date(a.deadline).getTime() : Infinity) - (b.deadline ? new Date(b.deadline).getTime() : Infinity);
    });
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  return (
    <div className="flex flex-col gap-6 pt-2">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <h1 className="text-display">{creatorView ? "My campaigns" : "Campaigns"}</h1>
          <p className="mt-1 text-body text-muted-foreground">{creatorView ? "Campaigns your pages are booked on, and what's left to post." : "Every campaign, how far along it is, and what it has spent."}</p>
        </div>
        {canCreate && (
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            <Plus />
            New campaign
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as Tab);
            setPage(1);
          }}
        >
          <div className="px-5 pt-2">
            <TabsList className="border-b-0">
              <TabsTrigger value="live">Live ({counts.live})</TabsTrigger>
              <TabsTrigger value="ended">Ended ({counts.ended})</TabsTrigger>
              <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
            </TabsList>
          </div>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-4">
          <SearchField
            label="Search campaigns"
            placeholder="Search campaign or brand..."
            className="w-full sm:w-72"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <FilterSelect
            className="sm:ml-auto"
            label="Sort"
            icon={ArrowUpDown}
            value={sort}
            onValueChange={setSort}
            options={[
              { value: "deadline", label: "Deadline" },
              { value: "newest", label: "Newest" },
              ...(creatorView ? [] : [{ value: "spend", label: "Highest spend" }]),
            ]}
          />
        </div>

        {list.isError ? (
          <LoadError onRetry={() => list.refetch()} what="campaigns" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Posts</TableHead>
                <TableHead>{creatorView ? "Your earnings" : "Spend vs budget"}</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>{creatorView ? "To post" : "Needs a look"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading
                ? Array.from({ length: 4 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-9 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : shown.map((c) => <CampaignRow key={c.id} c={c} creatorView={creatorView} />)}
              {!list.isLoading && shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    {all.length === 0 ? (
                      <EmptyState name="empty-campaigns" title="No campaigns yet">
                        {creatorView ? "When a brand books one of your pages, the campaign shows up here." : canCreate ? "Approving a plan creates its campaign, or start one yourself with New campaign." : "Approving a plan creates its campaign."}
                      </EmptyState>
                    ) : (
                      <EmptyState name="empty-search" title="No campaigns match">
                        Clear the search or pick another tab.
                      </EmptyState>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
        <Pager total={rows.length} page={current} pages={pages} noun="campaigns" onPage={setPage} />
      </Card>

      {canCreate && (
        <NewCampaignDialog
          open={creating}
          onOpenChange={(o) => {
            setCreating(o);
            if (!o && params.get("new")) router.replace("/campaigns");
          }}
          onCreated={(id) => {
            setCreating(false);
            router.push(`/campaigns/${id}`);
          }}
        />
      )}
    </div>
  );
}

function CampaignRow({ c, creatorView }: { c: Campaign; creatorView: boolean }) {
  const cap = c.costCap ? Number(c.costCap) : null;
  const spent = c.spent ?? 0;
  const quota = c.pageQuota ?? [];
  const booked = quota.reduce((s, q) => s + q.booked, 0);
  const submitted = quota.reduce((s, q) => s + q.submitted, 0);
  const ended = isEnded(c);
  const router = useRouter();
  return (
    <TableRow className="cursor-pointer" onClick={openRow(router.push, `/campaigns/${c.id}`)}>
      <TableCell>
        <Link href={`/campaigns/${c.id}`} className="flex items-center gap-3 text-foreground hover:text-brand-ink">
          {c.representativePost?.thumbnailUrl ? (
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
          )}
          <span className="min-w-0">
            <span className="block truncate text-body-strong">{c.title}</span>
            <span className="block truncate text-small text-fg-muted">
              {c.brandName}
              {(c.phaseCount ?? 1) > 1 ? ` · ${c.phaseCount} phases` : ""}
            </span>
          </span>
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">{creatorView && booked ? `${submitted} of ${booked} posted` : plural(c.postCount ?? 0, "post")}</TableCell>
      <TableCell className="min-w-48">
        {creatorView ? (
          <Money value={c.yourEarnings ?? 0} className="font-semibold" />
        ) : cap ? (
          <SpendMeter spent={spent} cap={cap} label={`${c.title} spend against budget`} />
        ) : (
          <span className="text-small text-muted-foreground">
            <Money value={spent} /> spent · no budget set
          </span>
        )}
      </TableCell>
      <TableCell className={cn("whitespace-nowrap", ended ? "text-muted-foreground" : "text-foreground")}>{deadlineLabel(c)}</TableCell>
      <TableCell>
        {creatorView ? (
          booked > submitted ? <StatusPill tone={ended ? "danger" : "warning"}>{plural(booked - submitted, "post")} to go</StatusPill> : <StatusPill tone="success">All posted</StatusPill>
        ) : (c.pendingAssignmentCount ?? 0) > 0 ? (
          <StatusPill tone="warning">{plural(c.pendingAssignmentCount ?? 0, "page")} not in Inventory</StatusPill>
        ) : cap && spent > cap ? (
          <StatusPill tone="danger">Over budget</StatusPill>
        ) : (
          <StatusPill tone="success">On track</StatusPill>
        )}
      </TableCell>
    </TableRow>
  );
}
