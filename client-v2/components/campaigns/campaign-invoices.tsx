"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, hasAccess, invoices as invoicesApi, type Invoice } from "@/lib/api-client";
import { personLabel, plural } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/taggify/illustration";
import { Money } from "@/components/taggify/money";
import { StatusPill } from "@/components/taggify/status-pill";
import { InvoiceAttachmentField } from "@/components/finance/invoice-attachment";
import { LoadError } from "@/components/finance/states";

const STATUS: Record<Invoice["status"], { label: string; tone: "warning" | "info" | "success" | "danger" | "neutral" }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  RAISED: { label: "Waiting for approval", tone: "warning" },
  APPROVED: { label: "Approved · to pay", tone: "info" },
  PAID: { label: "Paid", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};
const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/**
 * Campaign detail → Invoices (v1 CampaignInvoicesPanel): the invoices raised for
 * this campaign. GET /invoices?campaignId is own-scoped on the server, so a
 * creator sees only theirs. Approve is finance.approve; paying happens on the
 * creator's Payouts page (finance.pay); the creator's own file needs finance.edit.
 */
export function CampaignInvoices({ campaignId }: { campaignId: string }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const isCreator = user?.role === "CREATOR" || user?.role === "TEAM_MEMBER";
  const canApprove = hasAccess(user, "finance.approve");
  const canPay = hasAccess(user, "finance.pay");

  const list = useQuery({
    queryKey: ["invoices", "campaign", campaignId],
    queryFn: () => invoicesApi.list(accessToken!, { campaignId, pageSize: 100 }),
    enabled: !!accessToken,
  });
  const rows = list.data?.items ?? [];

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["invoices"] }), qc.invalidateQueries({ queryKey: ["payments"] }), qc.invalidateQueries({ queryKey: ["links"] })]);
  const approve = useMutation({
    mutationFn: (inv: Invoice) => invoicesApi.approve(accessToken!, inv.id),
    onSuccess: async (_r, inv) => {
      await refresh();
      toast.success(`${inv.invoiceNumber} approved.${canPay ? " Pay it from Payouts." : ""}`);
    },
    // The server re-checks bookings; a refusal means this row is stale.
    onError: async (e) => {
      toast.error(errText(e, "Couldn't approve it. Try again."));
      await refresh();
    },
  });
  const pdf = useMutation({
    mutationFn: (inv: Invoice) => invoicesApi.downloadPdf(accessToken!, inv.id, inv.invoiceNumber),
    onError: (e) => toast.error(errText(e, "Couldn't download the PDF.")),
  });
  // A planner's PDF check goes by the invoice's own campaign tag (server getInvoiceDetail).
  const canPdf = (inv: Invoice) => user?.role !== "PLAN_MAKER" || !!inv.campaignId;

  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div>
          <h2 className="text-card-title">Invoices</h2>
          <p className="text-small text-muted-foreground">
            {rows.length === 0 ? "Nothing invoiced for this campaign yet." : isCreator ? `${plural(rows.length, "invoice")} for your work on this campaign.` : `${plural(rows.length, "invoice")} raised for this campaign so far.`}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={isCreator ? "/money" : "/finance/invoices"}>{isCreator ? "Raise an invoice" : "Open Invoices"}</Link>
        </Button>
      </div>

      {list.isError ? (
        <div className="border-t">
          <LoadError onRetry={() => list.refetch()} what="this campaign's invoices" />
        </div>
      ) : list.isLoading ? (
        <div className="flex flex-col gap-2 border-t p-5">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="border-t">
          <EmptyState name="empty-dues" title="No invoices yet">
            {isCreator ? "Raise an invoice for your verified posts from Money." : "Invoices appear here once a creator raises one for this campaign."}
          </EmptyState>
        </div>
      ) : (
        <ul className="divide-y border-t" data-testid="campaign-invoice-list">
          {rows.map((inv) => {
            const over = inv.overQuotaCount ?? 0;
            const st = STATUS[inv.status];
            const posts = inv.items?.length ?? 0;
            const raisedByCreator = !inv.raisedBy || inv.raisedBy.id === inv.creatorId;
            return (
              <li key={inv.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center" data-testid={`campaign-invoice-${inv.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2">
                    <span className="text-body-strong">{inv.invoiceNumber}</span>
                    {!isCreator && <span className="truncate text-muted-foreground">{personLabel(inv.creator, "Creator")}</span>}
                  </p>
                  <p className="text-small text-fg-muted">
                    {posts > 0 && `${plural(posts, "post")} · `}
                    {raisedByCreator ? "Raised by the creator" : `Made by ${inv.raisedBy?.name ?? "the team"}`}
                    {inv.isGstInvoice && " · GST invoice"}
                    {inv.overdueDays > 0 && (inv.status === "APPROVED" || inv.status === "RAISED") && <span className="text-danger-helper"> · {plural(inv.overdueDays, "day")} past due</span>}
                  </p>
                  <div className="mt-1">
                    <InvoiceAttachmentField invoice={inv} compact attachLabel={isCreator ? "Attach your invoice" : "Attach the creator's invoice"} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 md:justify-end">
                  {over > 0 && inv.status !== "REJECTED" && inv.status !== "PAID" ? <StatusPill tone="danger">{plural(over, "post")} over booking</StatusPill> : <StatusPill tone={st.tone}>{st.label}</StatusPill>}
                  <span className="min-w-24 text-right font-semibold">
                    <Money value={inv.amount} />
                  </span>
                  {canApprove && inv.status === "RAISED" && over === 0 && (
                    <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(inv)}>
                      Approve
                    </Button>
                  )}
                  {canPay && inv.status === "APPROVED" && over === 0 && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/finance/payouts/${inv.creatorId}?invoice=${inv.id}`}>Pay</Link>
                    </Button>
                  )}
                  {canPdf(inv) && (
                    <Button variant="ghost" size="icon" aria-label={`Download ${inv.invoiceNumber} PDF`} disabled={pdf.isPending} onClick={() => pdf.mutate(inv)}>
                      <Download />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {rows.some((r) => (r.overQuotaCount ?? 0) > 0 && r.status !== "REJECTED" && r.status !== "PAID") && (
        <p className="border-t px-5 py-3 text-small text-muted-foreground">An invoice with posts over the booking can&apos;t be approved. Reject it on Invoices so the creator raises it again with only the booked posts.</p>
      )}
    </Card>
  );
}
