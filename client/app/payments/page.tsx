"use client";

import { useState } from "react";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { ClientInvoicesPanel } from "@/components/invoices/client-invoices-panel";
import { AdminPayouts } from "@/components/payments/admin-payouts";
import { CreatorPayments } from "@/components/payments/creator-payments";
import { hasAccess, canUse } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { initialsOf, roleLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function PaymentsPage() {
  return (
    <RequireAuth>
      <PaymentsContent />
    </RequireAuth>
  );
}

/**
 * Payments (tasks.md #5, 23 Sep; redesigned 24 Sep).
 *   · finance.pay holders (Admin/Finance by default): two directions —
 *     "Internal · creator payouts" (Pending/Paid, see AdminPayouts) and
 *     "Client receivables" (what clients owe us).
 *   · a CREATOR: their own Pending/Paid view (CreatorPayments) — every read
 *     there is server-scoped to pages they own.
 *   · anyone else: a plain "restricted" message instead of a page that 403s.
 */
function PaymentsContent() {
  const { user, accessToken } = useAuth();
  const token = accessToken!;
  const [direction, setDirection] = useState<"internal" | "receivables">("internal");

  const canPay = hasAccess(user, "finance.pay");
  // A creator's own Payouts view — only while their Invoices & payouts section is on (24 Sep).
  const isCreator = user?.role === "CREATOR" && canUse(user, "finance.view");
  const shellUser = {
    initials: initialsOf(user?.name),
    name: user?.name ?? "—",
    role: roleLabel(user?.role),
    tone: user?.role === "FINANCE" ? ("blue" as const) : ("emerald" as const),
  };

  if (!canPay && !isCreator) {
    return (
      <AppShell active="payments" user={shellUser} searchPlaceholder="Search…">
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface p-10 text-center">
          <p className="text-[0.9375rem] font-semibold">Payments is restricted</p>
          <p className="max-w-[42ch] text-[0.8125rem] text-text-muted">Only Admin and Finance accounts (or a role explicitly granted it) can see payouts and receivables.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="payments" user={shellUser} searchPlaceholder={canPay ? "Search payouts, vendors, invoices…" : "Search…"}>
      <div className="flex flex-col gap-6">
        <div>
          <p className="mb-1 text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">Finance</p>
          <h1 className="mb-1 text-[1.5rem] font-semibold leading-tight tracking-[-0.03em] md:text-[1.625rem]">Payments</h1>
          <p className="max-w-[60ch] text-[0.875rem] text-text-muted">
            {!canPay
              ? "What you've earned from your posted links — what's still to be paid, and every payout with its receipt."
              : direction === "internal"
                ? "Every verified link not yet paid. Filter, select one vendor's links, and pay them in one go."
                : "What clients owe us, on plans with a real invoice attached — not just the Proforma."}
          </p>
        </div>

        {canPay ? (
          <>
            <div role="tablist" aria-label="Payments direction" className="inline-flex w-fit rounded-full border border-border bg-surface p-1 text-[0.8125rem] shadow-card">
              {(
                [
                  ["internal", "Internal · creator payouts"],
                  ["receivables", "Client receivables"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={direction === key}
                  onClick={() => setDirection(key)}
                  className={cn("rounded-full px-3.5 py-1.5 font-medium transition-colors", direction === key ? "bg-ink text-ink-fg" : "text-text-muted hover:text-text")}
                >
                  {label}
                </button>
              ))}
            </div>

            {direction === "internal" ? (
              <AdminPayouts token={token} />
            ) : (
              <ClientInvoicesPanel token={token} canManage hasAttachment showAttachmentControl searchPlaceholder="Search plan maker, client, invoice…" />
            )}
          </>
        ) : (
          <CreatorPayments token={token} />
        )}
      </div>
    </AppShell>
  );
}
