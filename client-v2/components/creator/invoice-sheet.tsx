"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, ExternalLink, FileText } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, invoices as invoicesApi, type Invoice } from "@/lib/api-client";
import { formatLabel } from "@/lib/finance";
import { plural } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Money } from "@/components/taggify/money";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/** v1 invoice card downloads: the PDF, and the plain list of its post links. */
export function useInvoiceDownloads() {
  const { accessToken } = useAuth();
  const pdf = useMutation({
    mutationFn: (inv: Invoice) => invoicesApi.downloadPdf(accessToken!, inv.id, inv.invoiceNumber),
    onError: (e) => toast.error(errText(e, "Couldn't download the PDF.")),
  });
  const links = useMutation({
    mutationFn: (inv: Invoice) => invoicesApi.downloadLinks(accessToken!, inv.id, inv.invoiceNumber),
    onError: (e) => toast.error(errText(e, "Couldn't download the links.")),
  });
  return { pdf, links };
}

/** One of the creator's own invoices: its posts, the totals, and both downloads. */
export function MyInvoiceSheet({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const { pdf, links } = useInvoiceDownloads();
  const items = invoice?.items ?? [];
  return (
    <Sheet open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        {invoice && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="text-section">{invoice.invoiceNumber}</SheetTitle>
              <SheetDescription>
                Sent {new Date(invoice.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                {invoice.campaign ? ` · ${invoice.campaign.title}` : ""} · {plural(items.length, "post")}
              </SheetDescription>
            </SheetHeader>
            {items.length > 0 && (
              <ul className="flex flex-col divide-y rounded-card border" aria-label="Posts on this invoice">
                {items.map((it) => (
                  <li key={it.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <a href={it.link.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-body-strong">
                        {formatLabel(it.link.format)}
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      </a>
                      <span className="block truncate text-small text-fg-muted">{it.link.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                    </span>
                    <Money value={it.amount} className="font-semibold" />
                  </li>
                ))}
              </ul>
            )}
            <dl className="grid grid-cols-2 gap-y-1 rounded-card border p-3 text-body">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="text-right">
                <Money value={invoice.subtotal} />
              </dd>
              <dt className="text-muted-foreground">GST</dt>
              <dd className="text-right">{invoice.isGstInvoice ? <Money value={invoice.gstAmount} signed /> : "No GST"}</dd>
              <dt className="font-semibold">Total</dt>
              <dd className="text-right font-semibold">
                <Money value={invoice.amount} />
              </dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={pdf.isPending} onClick={() => pdf.mutate(invoice)}>
                <Download />
                {pdf.isPending ? "Preparing PDF…" : "Download PDF"}
              </Button>
              <Button variant="outline" disabled={links.isPending} onClick={() => links.mutate(invoice)}>
                <FileText />
                {links.isPending ? "Preparing…" : "Download links"}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
