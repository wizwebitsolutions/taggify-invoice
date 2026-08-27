"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { TableSkeleton, EmptyState } from "@/components/ui/table-parts";
import { ClockIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { admin as adminApi } from "@/lib/api-client";
import { initialsOf, roleLabel } from "@/lib/format";

const JOB_STATUS_TONE: Record<string, "emerald" | "rose" | "blue"> = {
  success: "emerald",
  failed: "rose",
  running: "blue",
};

export default function JobRunsPage() {
  return (
    <RequireAuth>
      <JobRunsContent />
    </RequireAuth>
  );
}

function JobRunsContent() {
  const { user, accessToken } = useAuth();
  const token = accessToken!;
  const isAdmin = user?.role === "ADMIN";

  const jobRunsQuery = useQuery({
    queryKey: ["job-runs"],
    queryFn: () => adminApi.jobRuns(token),
    enabled: isAdmin,
  });

  return (
    <AppShell
      active="job-runs"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search job runs…"
    >
      <div className="flex flex-col gap-7">
        <div>
          <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">Admin</p>
          <h1 className="mb-1.5 text-[1.625rem] font-bold">Job runs</h1>
          <p className="text-[0.9375rem] text-text-muted">
            node-cron execution history — the substitute for a job queue&apos;s built-in observability.
          </p>
        </div>

        {!isAdmin ? (
          <div className="rounded-lg border border-border bg-surface p-8 text-center shadow-card">
            <p className="text-[0.9375rem] text-text-muted">Job run history is available to Admin accounts.</p>
          </div>
        ) : jobRunsQuery.isLoading ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <TableSkeleton />
          </div>
        ) : (jobRunsQuery.data ?? []).length === 0 ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <EmptyState label="No job runs recorded yet." />
          </div>
        ) : (
          // overflow-x-auto + a min-width floor — this table scrolls within
          // its own card on a narrow screen instead of the whole page
          // scrolling sideways.
          <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
            <div className="grid min-w-[640px] grid-cols-[1.4fr_1fr_1.3fr_1.3fr_2fr] gap-3 border-b border-border px-5 py-3.5">
              <Th>Job</Th>
              <Th>Status</Th>
              <Th>Started</Th>
              <Th>Finished</Th>
              <Th>Error</Th>
            </div>
            {(jobRunsQuery.data ?? []).map((run) => (
              <div key={run.id} className="grid min-w-[640px] grid-cols-[1.4fr_1fr_1.3fr_1.3fr_2fr] items-center gap-3 border-b border-border px-5 py-4 last:border-b-0">
                <div className="flex items-center gap-2.5">
                  <ClockIcon className="h-4 w-4 shrink-0 text-text-faint" />
                  <span className="truncate text-[0.8438rem] font-semibold">{run.jobName}</span>
                </div>
                <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[0.6875rem] font-bold ${pillClass(JOB_STATUS_TONE[run.status] ?? "blue")}`}>
                  {run.status}
                </span>
                <span className="text-[0.8125rem] text-text-faint">{new Date(run.startedAt).toLocaleString()}</span>
                <span className="text-[0.8125rem] text-text-faint">{run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "—"}</span>
                <span className="truncate text-[0.8125rem] text-rose">{run.error ?? "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <div className="text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-text-faint">{children}</div>;
}

function pillClass(tone: "emerald" | "rose" | "blue") {
  if (tone === "emerald") return "bg-accent-soft text-accent";
  if (tone === "rose") return "bg-rose-soft text-rose";
  return "bg-blue-soft text-blue";
}
