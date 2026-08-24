import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StatusPill, type PillStatus } from "@/components/ui/status-pill";
import { StatusTimeline } from "@/components/dashboard/status-timeline";
import {
  LinkIcon,
  CameraIcon,
  CheckCircleIcon,
  InvoiceIcon,
  AlertIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  HeartIcon,
  MessageIcon,
} from "@/components/icons";

const USER = { initials: "DC", name: "Demo Creator", role: "Creator" };

const LINKS: {
  id: string;
  title: string;
  url: string;
  page: string;
  format: string;
  cost: string;
  likes: string;
  comments: string;
  status: PillStatus;
  selected?: boolean;
}[] = [
  {
    id: "1",
    title: "Demo Brand × Launch Campaign",
    url: "instagram.com/p/abc123",
    page: "@demo.page",
    format: "Reel",
    cost: "₹12,500",
    likes: "18.0K",
    comments: "97",
    status: "INSIGHTS_PENDING",
    selected: true,
  },
  {
    id: "2",
    title: "Northfield Running Co. × Derby Series",
    url: "instagram.com/p/xk291",
    page: "@demo.page",
    format: "Story",
    cost: "₹10,000",
    likes: "1.3K",
    comments: "27",
    status: "SCREENSHOT_APPROVED",
  },
  {
    id: "3",
    title: "Solmate Coffee × Launch Week",
    url: "instagram.com/p/qm771",
    page: "@demo.page",
    format: "Carousel",
    cost: "₹12,500",
    likes: "18.0K",
    comments: "97",
    status: "INVOICED",
  },
  {
    id: "4",
    title: "Byteloop AI × Creator Spotlight",
    url: "instagram.com/p/vv430",
    page: "@demo.page",
    format: "Reel",
    cost: "₹12,500",
    likes: "772",
    comments: "33",
    status: "SCREENSHOT_REJECTED",
  },
  {
    id: "5",
    title: "Verdant Skincare × Retreat Campaign",
    url: "instagram.com/p/rr812",
    page: "@demo.page",
    format: "Collab",
    cost: "₹14,000",
    likes: "4.2K",
    comments: "58",
    status: "SUBMITTED",
  },
];

const selectedLink = LINKS.find((l) => l.selected) ?? LINKS[0];

export default function DashboardPage() {
  return (
    <AppShell
      active="dashboard"
      user={USER}
      searchPlaceholder="Search links, campaigns, pages…"
      topbarActions={
        <Button size="default">
          <PlusIcon className="h-[15px] w-[15px] text-accent-ink" />
          Submit link
        </Button>
      }
    >
      <div className="flex flex-col gap-7">
        <div>
          <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">
            Overview
          </p>
          <h1 className="mb-1.5 text-[1.625rem] font-bold">My Works</h1>
          <p className="text-[0.9375rem] text-text-muted">Every submitted link, tracked from post to payout.</p>
        </div>

        <div className="grid grid-cols-5 gap-4">
          <KpiCard icon={LinkIcon} label="Links added" value="2,634" />
          <KpiCard icon={CameraIcon} label="Pending screenshots" value="2,518" />
          <KpiCard icon={CheckCircleIcon} label="Links approved" value="2,601" />
          <KpiCard icon={InvoiceIcon} label="Links invoiced" value="2,009" />
          <KpiCard icon={AlertIcon} label="Uninvoiced links" value="625" tone="gold" />
        </div>

        <div className="flex items-center gap-2.5">
          <Chip>All statuses <ChevronDownIcon className="h-3 w-3" /></Chip>
          <Chip>Last 30 days <ChevronDownIcon className="h-3 w-3" /></Chip>
          <Chip>All pages <ChevronDownIcon className="h-3 w-3" /></Chip>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" className="rounded-full">
            Bulk invoice · 1 selected
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 gap-5">
          <div className="flex-1 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            <div className="grid grid-cols-[28px_minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_24px] gap-3 border-b border-border px-5 py-3.5">
              <div />
              <Th>Post</Th>
              <Th>Page</Th>
              <Th>Format</Th>
              <Th>Cost</Th>
              <Th>Engagement</Th>
              <Th>Status</Th>
              <div />
            </div>
            <div>
              {LINKS.map((link) => (
                <div
                  key={link.id}
                  className={`grid grid-cols-[28px_minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_24px] items-center gap-3 border-b border-border px-5 py-3.5 ${link.selected ? "bg-surface-2" : ""}`}
                >
                  <div className="flex h-4 w-4 items-center justify-center rounded-[5px] border-[1.5px] border-border-strong">
                    {link.selected && (
                      <div className="flex h-full w-full items-center justify-center rounded-[4px] bg-accent text-accent-ink">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-[11px] w-[11px]">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-10 w-10 shrink-0 rounded-[9px] bg-gradient-to-br from-accent-soft to-accent-2-soft" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{link.title}</div>
                      <div className="mt-0.5 text-xs text-text-faint">{link.url}</div>
                    </div>
                  </div>
                  <div className="text-[0.8438rem] text-text-muted">{link.page}</div>
                  <div className="text-[0.8438rem] text-text-muted">{link.format}</div>
                  <div className="text-sm font-bold tabular-nums">{link.cost}</div>
                  <div className="flex min-w-0 items-center gap-2.5 text-xs text-text-faint">
                    <span className="flex items-center gap-1">
                      <HeartIcon className="h-[13px] w-[13px]" /> {link.likes}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageIcon className="h-[13px] w-[13px]" /> {link.comments}
                    </span>
                  </div>
                  <div>
                    <StatusPill status={link.status} />
                  </div>
                  <ChevronRightIcon className="h-3.5 w-3.5 text-text-faint" />
                </div>
              ))}
            </div>
          </div>

          <div className="flex w-[320px] shrink-0 flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-card">
            <div className="h-[140px] rounded-[14px] bg-gradient-to-br from-accent-soft to-accent-2-soft" />
            <div>
              <p className="text-base font-bold">{selectedLink.title}</p>
              <p className="mt-1 text-[0.8125rem] text-text-faint">
                {selectedLink.page} · {selectedLink.format} · {selectedLink.url}
              </p>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-xs text-text-faint">Rate-card cost</span>
              <span className="text-[1.125rem] font-extrabold tabular-nums">{selectedLink.cost}</span>
            </div>

            <StatusTimeline
              steps={[
                { title: "Submitted", time: "Aug 21, 10:42 AM", state: "done" },
                { title: "Screenshot approved", time: "Aug 21, 2:15 PM", state: "done" },
                { title: "Insights pending", time: "Awaiting metrics refresh", state: "current" },
                { title: "Invoiced", state: "pending" },
              ]}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <div className="text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-text-faint">{children}</div>;
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[38px] items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-[0.8125rem] text-text-muted">
      {children}
    </div>
  );
}
