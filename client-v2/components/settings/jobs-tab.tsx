"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { admin as adminApi, ApiError, type JobRun } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/taggify/illustration";
import { StatusPill, type StatusTone } from "@/components/taggify/status-pill";
import { LoadError } from "@/components/finance/states";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/** Every job the server schedules (server modules/jobs/index.js), in plain words. */
const JOBS: Record<string, { label: string; what: string }> = {
  finance_export: { label: "Finance export (GitHub)", what: "Daily finance data, saved to the GitHub archive." },
  finance_google_sheet_export: { label: "Finance export (Google Sheet)", what: "The same daily data, written to the live Google Sheet." },
  instagram_rescrape: { label: "Post numbers refresh", what: "Fetches the latest views and likes for posts still waiting on insights." },
  asset_profile_rescrape: { label: "Page numbers refresh", what: "Fetches followers, name and picture for every approved page." },
  invoice_aging_sweep: { label: "Invoice ageing check", what: "Tells the creator and Finance about raised invoices past their due date." },
  screenshot_reminder: { label: "Proof reminders", what: "Reminds creators about submitted posts still missing a proof." },
};
const STATUS: Record<JobRun["status"], { tone: StatusTone; label: string }> = {
  success: { tone: "success", label: "Worked" },
  failed: { tone: "danger", label: "Failed" },
  running: { tone: "info", label: "Running" },
};
const labelOf = (name: string) => JOBS[name]?.label ?? name;

/**
 * Background jobs (GET /admin/job-runs, finance.edit): the last 50 runs, the
 * latest one per job, and the two finance exports that can be run by hand
 * (POST /admin/finance-export/run-now and /finance-google-sheet-export/run-now).
 */
export function JobsTab() {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const runs = useQuery({ queryKey: ["jobRuns"], queryFn: () => adminApi.jobRuns(accessToken!), enabled: !!accessToken });
  const refresh = () => qc.invalidateQueries({ queryKey: ["jobRuns"] });

  const github = useMutation({
    mutationFn: () => adminApi.runFinanceExportNow(accessToken!),
    onSuccess: (r) => toast.success("Finance export saved to GitHub.", r.htmlUrl ? { action: { label: "Open", onClick: () => window.open(r.htmlUrl, "_blank", "noopener") } } : undefined),
    onError: (e) => toast.error(errText(e, "The finance export didn't run.")),
    onSettled: refresh,
  });
  const sheet = useMutation({
    mutationFn: () => adminApi.runFinanceGoogleSheetExportNow(accessToken!),
    onSuccess: (r) => toast.success("Finance export written to the Google Sheet.", r.spreadsheetUrl ? { action: { label: "Open", onClick: () => window.open(r.spreadsheetUrl, "_blank", "noopener") } } : undefined),
    onError: (e) => toast.error(errText(e, "The Google Sheet export didn't run.")),
    onSettled: refresh,
  });
  const runNow: Record<string, typeof github> = { finance_export: github, finance_google_sheet_export: sheet };

  const all = runs.data ?? [];
  const latest = new Map<string, JobRun>();
  for (const r of all) if (!latest.has(r.jobName)) latest.set(r.jobName, r); // newest first from the server
  const names = [...new Set([...Object.keys(JOBS), ...latest.keys()])];

  if (runs.isError) return <LoadError onRetry={() => runs.refetch()} what="job runs" />;

  return (
    <div className="flex flex-col gap-6 border-t p-6">
      <section aria-labelledby="jobs-latest" className="flex flex-col gap-3">
        <h2 id="jobs-latest" className="section-heading text-card-title">
          Jobs
        </h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {names.map((name) => {
            const last = latest.get(name);
            const run = runNow[name];
            return (
              <li key={name} className="flex flex-wrap items-start gap-4 rounded-card border border-input bg-muted/30 p-5" data-testid={`job-${name}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-body-strong">{labelOf(name)}</p>
                  {JOBS[name] && <p className="text-small text-muted-foreground">{JOBS[name].what}</p>}
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-small text-muted-foreground">
                    {runs.isLoading ? (
                      <Skeleton className="h-5 w-40" />
                    ) : last ? (
                      <>
                        <StatusPill tone={STATUS[last.status]?.tone ?? "neutral"}>{STATUS[last.status]?.label ?? last.status}</StatusPill>
                        <span>{when(last.startedAt)}</span>
                      </>
                    ) : (
                      "No runs in the last 50"
                    )}
                  </p>
                  {last?.status === "failed" && last.error && <p className="mt-1 line-clamp-2 break-words text-small text-danger-helper">{last.error}</p>}
                </div>
                {run && (
                  <Button variant="outline" size="sm" disabled={run.isPending} onClick={() => run.mutate()} aria-label={`Run ${labelOf(name)} now`}>
                    <Play />
                    {run.isPending ? "Running…" : "Run now"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="jobs-history" className="flex flex-col gap-3">
        <h2 id="jobs-history" className="section-heading text-card-title">
          History
        </h2>
        {runs.isLoading ? (
          <Skeleton className="h-40" />
        ) : all.length === 0 ? (
          <EmptyState name="empty-content" title="No runs yet">
            Jobs run on their own schedule. Their results show up here.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-card border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="hidden md:table-cell">Took</TableHead>
                  <TableHead className="hidden md:table-cell">Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {all.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-body-strong">{labelOf(r.jobName)}</TableCell>
                    <TableCell>
                      <StatusPill tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</StatusPill>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-small text-muted-foreground">{when(r.startedAt)}</TableCell>
                    <TableCell className="hidden whitespace-nowrap text-small text-muted-foreground md:table-cell">{r.finishedAt ? took(r.startedAt, r.finishedAt) : "—"}</TableCell>
                    <TableCell className="hidden max-w-[360px] truncate text-small text-danger-helper md:table-cell" title={r.error ?? undefined}>
                      {r.error ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

function took(from: string, to: string) {
  const s = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
