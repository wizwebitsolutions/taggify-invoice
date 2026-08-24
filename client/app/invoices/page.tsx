import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StatusPill, type PillStatus, type GstStatus } from "@/components/ui/status-pill";
import { ChevronDownIcon, DownloadIcon } from "@/components/icons";

const USER = { initials: "FU", name: "Finance User", role: "Finance", tone: "blue" as const };

const INVOICES: {
  id: string;
  number: string;
  creator: string;
  amount: string;
  status: PillStatus;
  gst: GstStatus;
  aging: string;
  overdue?: boolean;
  actionable?: boolean;
  selected?: boolean;
}[] = [
  {
    id: "1",
    number: "INV-260714-8811",
    creator: "Demo Creator",
    amount: "₹8,11,250",
    status: "RAISED",
    gst: "SCHEDULED",
    aging: "Due Sep 8",
    actionable: true,
    selected: true,
  },
  {
    id: "2",
    number: "INV-260704-1755",
    creator: "Nightowl Media",
    amount: "₹25,53,520",
    status: "PAID",
    gst: "COMPLETED",
    aging: "Settled Jul 12",
  },
  {
    id: "3",
    number: "INV-260621-4402",
    creator: "Wanderloop Studio",
    amount: "₹2,53,520",
    status: "RAISED",
    gst: "PENDING",
    aging: "Overdue · 12d",
    overdue: true,
    actionable: true,
  },
  {
    id: "4",
    number: "INV-260610-9930",
    creator: "Daily Bulletin Co.",
    amount: "₹6,42,000",
    status: "PAID",
    gst: "COMPLETED",
    aging: "Settled Jun 18",
  },
];

const selected = INVOICES.find((i) => i.selected) ?? INVOICES[0];

export default function InvoicesPage() {
  return (
    <AppShell
      active="invoices"
      user={USER}
      searchPlaceholder="Search invoice number, creator…"
    >
      <div className="flex flex-col gap-7">
        <div>
          <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">Finance</p>
          <h1 className="mb-1.5 text-[1.625rem] font-bold">Invoices</h1>
          <p className="text-[0.9375rem] text-text-muted">
            Raised, paid, and GST status — tracked independently, settled manually.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <KpiCard label="Total raised" value="₹41,64,770" foot="16 invoices this quarter" />
          <KpiCard label="Pending payment" value="₹8,11,250" foot="1 invoice awaiting settlement" />
          <KpiCard label="Overdue" value="₹2,53,520" foot="1 invoice past due date" tone="rose" />
        </div>

        <div className="flex items-center gap-2.5">
          <Chip>All statuses <ChevronDownIcon className="h-3 w-3" /></Chip>
          <Chip>GST — any <ChevronDownIcon className="h-3 w-3" /></Chip>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" className="rounded-full">
            <DownloadIcon className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 gap-5">
          <div className="flex-1 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)] gap-3 border-b border-border px-5 py-3.5">
              <Th>Invoice</Th>
              <Th>Creator</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
              <Th>GST status</Th>
              <Th>Due</Th>
              <Th>Action</Th>
            </div>
            <div>
              {INVOICES.map((inv) => (
                <div
                  key={inv.id}
                  className={`grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-3 border-b border-border px-5 py-4 ${inv.selected ? "bg-surface-2" : ""}`}
                >
                  <div className="font-mono text-[0.8125rem] text-text-muted">{inv.number}</div>
                  <div className="text-[0.8438rem] text-text-muted">{inv.creator}</div>
                  <div className="text-[0.9375rem] font-bold tabular-nums">{inv.amount}</div>
                  <div>
                    <StatusPill status={inv.status} />
                  </div>
                  <div>
                    <StatusPill status={inv.gst} />
                  </div>
                  <div className={`text-xs ${inv.overdue ? "font-bold text-rose" : "text-text-faint"}`}>{inv.aging}</div>
                  <div>
                    {inv.actionable ? (
                      <Button variant="primary" size="sm" className="h-8 bg-accent-soft text-accent shadow-none hover:brightness-100">
                        Mark paid
                      </Button>
                    ) : (
                      <span className="text-[0.8438rem] text-text-muted">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex w-[340px] shrink-0 flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-card">
            <div>
              <div className="font-mono text-xs text-text-faint">{selected.number}</div>
              <div className="text-[1.875rem] font-extrabold tracking-tight tabular-nums">{selected.amount}</div>
            </div>
            <div className="flex gap-2">
              <StatusPill status={selected.status} />
              <StatusPill status={selected.gst} />
            </div>
            <div className="h-px bg-border" />
            <div className="flex flex-col gap-3">
              <LineItem title="Demo Brand × Launch Campaign" amount="₹12,500" />
              <LineItem title="Solmate Coffee × Launch Week" amount="₹12,500" />
              <LineItem title="+ 64 more approved links" amount="₹7,86,250" />
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3.5">
              <span className="text-[0.8125rem] text-text-faint">Total</span>
              <span className="text-[1.125rem] font-extrabold tabular-nums">{selected.amount}</span>
            </div>
            <Button size="lg" className="w-full">
              Mark as paid
            </Button>
            <Button variant="secondary" size="lg" className="w-full">
              Update GST status
            </Button>
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

function LineItem({ title, amount }: { title: string; amount: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-accent-soft to-accent-2-soft" />
      <div className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">{title}</div>
      <div className="text-[0.8125rem] font-bold tabular-nums">{amount}</div>
    </div>
  );
}
