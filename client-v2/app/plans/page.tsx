"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpDown, CircleCheck, ClipboardList, FileSpreadsheet, Plus, Wallet } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { type Plan } from "@/lib/api-client";
import { openRow } from "@/lib/utils";
import { isDraft, PLAN_STATUS, planPages, planValue, canEditPlan, canViewPlans } from "@/lib/plans";
import { monthKeyOf, inMonth } from "@/lib/finance";
import { plural } from "@/lib/format";
import { usePlans } from "@/lib/queries/plans";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterSelect } from "@/components/taggify/filter-select";
import { MetricTile } from "@/components/taggify/metric-tile";
import { Money } from "@/components/taggify/money";
import { SearchField } from "@/components/taggify/search-field";
import { StatusPill } from "@/components/taggify/status-pill";
import { UserAvatar } from "@/components/taggify/user-avatar";
import { PageAvatarStack } from "@/components/finance/identity";
import { Pager, PER_PAGE } from "@/components/finance/pager";
import { LoadError, NoAccess } from "@/components/finance/states";
import { EmptyState } from "@/components/taggify/illustration";
import { PlanFromSheetDialog } from "@/components/plans/plan-from-sheet-dialog";

type Tab = "all" | "planners" | "draft" | "approved" | "rejected";

export default function PlansPage() {
  return (
    <AppShell active="plans">
      <PlansOverview />
    </AppShell>
  );
}

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function PlansOverview() {
  const { user } = useAuth();
  const plans = usePlans();
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [planner, setPlanner] = useState("all");
  const router = useRouter();
  const [client, setClient] = useState("all");
  const [sort, setSort] = useState("updated");
  const [page, setPage] = useState(1);
  const [fromSheet, setFromSheet] = useState(false);
  const isPlanner = user?.role === "PLAN_MAKER";

  const list = useMemo(() => plans.data ?? [], [plans.data]);
  const planners = useMemo(() => {
    const m = new Map<string, { id: string; name: string; plans: Plan[] }>();
    for (const p of list) {
      const id = p.createdBy?.id ?? "unknown";
      if (!m.has(id)) m.set(id, { id, name: p.createdBy?.name ?? "Unknown planner", plans: [] });
      m.get(id)!.plans.push(p);
    }
    return [...m.values()].sort((a, b) => b.plans.length - a.plans.length);
  }, [list]);

  if (!canViewPlans(user)) return <NoAccess what="plans" />;

  const month = monthKeyOf(new Date());
  const drafts = list.filter(isDraft);
  const approvedThisMonth = list.filter((p) => p.status === "APPROVED" && inMonth(p.approvedAt, month));
  const clients = [...new Set(list.map((p) => p.clientName))].sort();
  const needle = q.trim().toLowerCase();
  const filtered = list
    .filter((p) => tab === "all" || tab === "planners" || (tab === "draft" ? isDraft(p) : tab === "approved" ? p.status === "APPROVED" : p.status === "REJECTED"))
    .filter((p) => planner === "all" || p.createdBy?.id === planner)
    .filter((p) => client === "all" || p.clientName === client)
    .filter((p) => !needle || `${p.name} ${p.clientName} ${p.variantLabel} ${p.createdBy?.name ?? ""}`.toLowerCase().includes(needle))
    .sort((a, b) => (sort === "value" ? planValue(b) - planValue(a) : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  return (
    <div className="flex flex-col gap-6 pt-2">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-display">{isPlanner ? "My plans" : "Plans"}</h1>
          <p className="mt-1 text-body text-muted-foreground">{isPlanner ? "Your plans, and what's waiting for a decision." : "Every plan, who owns it, and what's waiting for a decision."}</p>
        </div>
        {canEditPlan(user) && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setFromSheet(true)}>
              <FileSpreadsheet />
              New plan from sheet
            </Button>
            <Button asChild>
              <Link href="/plans/new">
                <Plus />
                Create plan
              </Link>
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricTile tone="amber" icon={ClipboardList} label="Awaiting approval" loading={plans.isLoading} value={`${drafts.length} draft${drafts.length === 1 ? "" : "s"}`} meta={<><Money value={drafts.reduce((s, p) => s + planValue(p), 0)} /> in client value</>} />
        <MetricTile tone="mint" icon={CircleCheck} label="Approved this month" loading={plans.isLoading} value={`${approvedThisMonth.length} plan${approvedThisMonth.length === 1 ? "" : "s"}`} meta="Each one became a campaign" />
        <MetricTile tone="coral" icon={Wallet} label="Planned value" loading={plans.isLoading} value={<Money value={list.reduce((s, p) => s + planValue(p), 0)} />} meta={`${list.length} plans · ${planners.length} planner${planners.length === 1 ? "" : "s"}`} />
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
              <TabsTrigger value="all">All plans ({list.length})</TabsTrigger>
              {!isPlanner && <TabsTrigger value="planners">Planners ({planners.length})</TabsTrigger>}
              <TabsTrigger value="draft">Drafts ({drafts.length})</TabsTrigger>
              <TabsTrigger value="approved">Approved ({list.filter((p) => p.status === "APPROVED").length})</TabsTrigger>
              <TabsTrigger value="rejected">Rejected ({list.filter((p) => p.status === "REJECTED").length})</TabsTrigger>
            </TabsList>
          </div>
        </Tabs>

        {plans.isError ? (
          <LoadError onRetry={() => plans.refetch()} what="plans" />
        ) : tab === "planners" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Planner</TableHead>
                <TableHead className="text-right">Plans</TableHead>
                <TableHead className="text-right">Planned value</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>Drafts</TableHead>
                <TableHead>Rejected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {planners.map((pl) => {
                // The whole row opens this planner's plans; the name is the keyboard target.
                const openPlanner = () => {
                  setPlanner(pl.id);
                  setTab("all");
                };
                return (
                <TableRow key={pl.id} className="cursor-pointer" onClick={openPlanner}>
                  <TableCell>
                    <button type="button" onClick={(e) => { e.stopPropagation(); openPlanner(); }} className="flex items-center gap-3 rounded-md text-left text-foreground hover:text-brand-ink">
                      <UserAvatar name={pl.name} size="sm" />
                      <span className="text-body-strong">{pl.name}</span>
                    </button>
                  </TableCell>
                  <TableCell className="num text-right">{pl.plans.length}</TableCell>
                  <TableCell className="text-right">
                    <Money value={pl.plans.reduce((s, p) => s + planValue(p), 0)} className="font-semibold" />
                  </TableCell>
                  <TableCell>
                    <StatusPill tone="success">{pl.plans.filter((p) => p.status === "APPROVED").length}</StatusPill>
                  </TableCell>
                  <TableCell>
                    <StatusPill tone="warning">{pl.plans.filter(isDraft).length}</StatusPill>
                  </TableCell>
                  <TableCell>
                    <StatusPill tone="danger">{pl.plans.filter((p) => p.status === "REJECTED").length}</StatusPill>
                  </TableCell>
                </TableRow>
                );
              })}
              {planners.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No planners have made plans yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-t px-5 py-4">
              <SearchField
                label="Search plans"
                placeholder="Search plan or client..."
                className="w-full sm:w-64"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
              {!isPlanner && <FilterSelect label="Planner" value={planner} onValueChange={setPlanner} options={[{ value: "all", label: "All" }, ...planners.map((p) => ({ value: p.id, label: p.name }))]} />}
              <FilterSelect label="Client" value={client} onValueChange={setClient} options={[{ value: "all", label: "All" }, ...clients.map((c) => ({ value: c, label: c }))]} />
              <FilterSelect
                className="sm:ml-auto"
                label="Sort"
                icon={ArrowUpDown}
                value={sort}
                onValueChange={setSort}
                options={[
                  { value: "updated", label: "Last updated" },
                  { value: "value", label: "Highest value" },
                ]}
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  {!isPlanner && <TableHead>Planner</TableHead>}
                  <TableHead>Pages</TableHead>
                  <TableHead className="text-right">Client value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.isLoading
                  ? Array.from({ length: 4 }, (_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={6}>
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : shown.map((p) => {
                      const st = PLAN_STATUS[p.status];
                      return (
                        <TableRow key={p.id} className="cursor-pointer" onClick={openRow(router.push, `/plans/${p.id}`)}>
                          <TableCell>
                            <Link href={`/plans/${p.id}`} className="flex items-center gap-3 text-foreground hover:text-brand-ink">
                              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-brand-soft text-label font-bold text-brand-ink">{p.variantLabel.replace("Plan ", "")}</span>
                              <span className="min-w-0">
                                <span className="block truncate text-body-strong">{p.name}</span>
                                <span className="block truncate text-small text-fg-muted">
                                  {p.clientName} · {p.variantLabel}
                                </span>
                              </span>
                            </Link>
                          </TableCell>
                          {!isPlanner && (
                            <TableCell>
                              <span className="flex items-center gap-2">
                                <UserAvatar name={p.createdBy?.name} size="xs" />
                                {p.createdBy?.name ?? "—"}
                              </span>
                            </TableCell>
                          )}
                          <TableCell className="text-muted-foreground">
                            <span className="flex items-center gap-2">
                              <PageAvatarStack pages={planPages(p)} />
                              <span className="whitespace-nowrap">{plural(p.overview.totalPosts, "post")}</span>
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            <Money value={planValue(p)} />
                          </TableCell>
                          <TableCell>
                            <span className="flex flex-wrap gap-1">
                              <StatusPill tone={st.tone}>{st.label}</StatusPill>
                              {(p.inactivePages?.length ?? 0) > 0 && <StatusPill tone="warning">Page unavailable</StatusPill>}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{ago(p.updatedAt)}</TableCell>
                        </TableRow>
                      );
                    })}
                {!plans.isLoading && shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      {list.length === 0 ? (
                        <EmptyState name="empty-plans" title="No plans yet">
                          Create one to pitch a client.
                        </EmptyState>
                      ) : (
                        <EmptyState name="empty-search" title="No plans match">
                          Clear the search or pick another tab.
                        </EmptyState>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <Pager total={filtered.length} page={current} pages={pages} noun="plans" onPage={setPage} />
          </>
        )}
      </Card>
      <PlanFromSheetDialog open={fromSheet} onOpenChange={setFromSheet} />
    </div>
  );
}
