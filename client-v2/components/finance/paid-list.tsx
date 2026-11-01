"use client";

import { Fragment, useState } from "react";
import { ChevronRight, Download } from "lucide-react";

import type { PaidLedgerRow } from "@/lib/api-client";
import { formatLabel } from "@/lib/finance";
import { compactNumber, personLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money } from "@/components/taggify/money";
import { displayHandle } from "./identity";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** A Payout row or a legacy invoice paid outside a payout, on one shape (v1 paidRowView). */
export function paidRowView(row: PaidLedgerRow) {
  if (row.kind === "payout") {
    const p = row.payout;
    return {
      id: p.id,
      paidAt: row.paidAt ?? p.paidAt,
      vendorId: p.creatorId,
      vendor: p.creator ?? null,
      by: p.markedPaidBy?.name ?? p.createdBy?.name ?? null,
      label: null as string | null,
      items: (p.items ?? []).map((i) => ({ id: i.id, amount: i.amount, link: i.link })),
      subtotal: p.subtotal,
      gst: p.isGstInvoice || Number(p.gstAmount) > 0 ? p.gstAmount : null,
      tds: p.tdsPercent ? { percent: Number(p.tdsPercent), amount: p.tdsAmount } : null,
      net: p.netAmount,
      utr: p.utr ?? null,
      receipt: p.receipt ?? null,
      legacy: false,
    };
  }
  const inv = row.invoice;
  return {
    id: inv.id,
    paidAt: row.paidAt ?? inv.paidAt,
    vendorId: inv.creatorId,
    vendor: inv.creator ?? null,
    by: null,
    label: `Invoice ${inv.invoiceNumber}`,
    items: inv.links.map((l) => ({ id: l.id, amount: l.cost ?? "0", link: l })),
    subtotal: inv.subtotal,
    gst: inv.isGstInvoice ? inv.gstAmount : null,
    // Paid directly, outside the payout flow, so no TDS was ever withheld.
    tds: null,
    net: inv.amount,
    utr: null,
    receipt: inv.receipt ?? null,
    legacy: true,
  };
}

/** Totals over the loaded rows, added up in whole paise so no float drift creeps in. */
export function paidTotals(rows: PaidLedgerRow[]) {
  const paise = (v: string | number) => Math.round(Number(v) * 100);
  let net = 0;
  let tds = 0;
  for (const r of rows) {
    net += paise(r.kind === "payout" ? r.payout.netAmount : r.invoice.amount);
    tds += r.kind === "payout" ? paise(r.payout.tdsAmount) : 0;
  }
  return { count: rows.length, net: net / 100, tds: tds / 100 };
}

/**
 * Paid payouts as a table: one row per payout (or legacy paid invoice) with its
 * tax split and receipt; open a row to see the posts it paid for.
 */
export function PaidTable({ rows, showVendor = false }: { rows: PaidLedgerRow[]; showVendor?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const cols = showVendor ? 10 : 9;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Paid on</TableHead>
          {showVendor && <TableHead>Vendor</TableHead>}
          <TableHead>Pages</TableHead>
          <TableHead className="text-right">Posts</TableHead>
          <TableHead className="text-right">Base</TableHead>
          <TableHead className="text-right">GST</TableHead>
          <TableHead className="text-right">TDS</TableHead>
          <TableHead className="text-right">Net paid</TableHead>
          <TableHead>Receipt</TableHead>
          <TableHead>
            <span className="sr-only">Posts</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const v = paidRowView(row);
          const expanded = open === v.id;
          const pages = [...new Set(v.items.map((i) => i.link.asset?.handle).filter(Boolean))] as string[];
          const sub = v.legacy ? `${v.label} · paid outside a payout` : v.by ? `by ${v.by}` : null;
          return (
            <Fragment key={`${row.kind}:${v.id}`}>
              <TableRow data-state={expanded ? "selected" : undefined} data-testid="paid-row">
                <TableCell className="whitespace-nowrap font-semibold">{day(v.paidAt)}</TableCell>
                {showVendor && (
                  <TableCell>
                    <span className="block font-medium">{personLabel(v.vendor, "Unnamed vendor")}</span>
                    {sub && <span className="block text-small text-fg-muted">{sub}</span>}
                  </TableCell>
                )}
                <TableCell className="text-muted-foreground">
                  <span className="block max-w-48 truncate">{pages.map((h) => displayHandle(h)).join(", ") || "—"}</span>
                  {!showVendor && sub && <span className="block text-small text-fg-muted">{sub}</span>}
                </TableCell>
                <TableCell className="text-right">{v.items.length}</TableCell>
                <TableCell className="text-right">
                  <Money value={v.subtotal} />
                </TableCell>
                <TableCell className="text-right">{v.gst !== null ? <Money value={v.gst} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {v.tds ? (
                    <span className="flex flex-col items-end">
                      <Money value={-Number(v.tds.amount)} signed />
                      <span className="text-small text-fg-muted">{v.tds.percent}%</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-bold">
                  <Money value={v.net} />
                </TableCell>
                <TableCell>
                  {v.receipt?.url ? (
                    <a className="inline-flex items-center gap-1 font-semibold text-foreground underline underline-offset-4 hover:text-brand-ink" href={v.receipt.url} target="_blank" rel="noreferrer">
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      View
                    </a>
                  ) : (
                    <span className="text-muted-foreground">{v.receipt?.name ?? "None on file"}</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Hide" : "Show"} posts paid on ${day(v.paidAt)}${showVendor ? ` to ${personLabel(v.vendor, "this vendor")}` : ""}`}
                    onClick={() => setOpen(expanded ? null : v.id)}
                    className="grid h-8 w-8 place-items-center rounded-sm text-fg-muted hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring-soft"
                  >
                    <ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} />
                  </button>
                </TableCell>
              </TableRow>
              {expanded && (
                <TableRow className="bg-muted hover:bg-muted">
                  <TableCell colSpan={cols} className="px-5 py-3">
                    <div data-testid="paid-row-posts" className="flex flex-col gap-2">
                      <p className="flex flex-wrap gap-x-5 gap-y-1 text-small text-muted-foreground">
                        <span>{v.utr ? `UTR ${v.utr}` : v.legacy ? "Paid directly, no UTR on file" : "No UTR recorded"}</span>
                        <span>{v.gst !== null ? "GST 18%" : "No GST"}</span>
                        <span>{v.tds ? `TDS ${v.tds.percent}%` : v.legacy ? "No TDS, paid outside a payout" : "No TDS"}</span>
                      </p>
                      {v.items.length === 0 ? (
                        <p className="text-small text-muted-foreground">No posts on file for this payment.</p>
                      ) : (
                        <ul className="flex flex-col divide-y rounded-card border bg-card">
                          {v.items.map((item) => {
                            const views = item.link.postSnapshots?.[0]?.videoViews;
                            return (
                              <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-small">
                                <a href={item.link.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-foreground hover:text-brand-ink hover:underline">
                                  {item.link.campaign?.title ?? item.link.url}
                                </a>
                                <span className="text-muted-foreground">{item.link.asset ? displayHandle(item.link.asset.handle) : "—"}</span>
                                <span className="text-muted-foreground">{formatLabel(item.link.format)}</span>
                                <span className="text-muted-foreground">{item.link.postedAt ? day(item.link.postedAt) : "—"}</span>
                                {typeof views === "number" && views >= 0 && <span className="text-muted-foreground">{compactNumber(views)} views</span>}
                                <Money value={item.amount} className="font-semibold" />
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
