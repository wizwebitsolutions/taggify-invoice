"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, ExternalLink, FileText, Link2, MoreHorizontal, Paperclip } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, canUse, hasAccess, invoices as invoicesApi, type Invoice } from "@/lib/api-client";
import { formatLabel } from "@/lib/finance";
import { personLabel, plural } from "@/lib/format";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { InvoiceAttachmentField } from "@/components/finance/invoice-attachment";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/taggify/illustration";
import { Money } from "@/components/taggify/money";
import { SearchField } from "@/components/taggify/search-field";
import { StatusPill } from "@/components/taggify/status-pill";
import { UserAvatar } from "@/components/taggify/user-avatar";
import { Pager, PER_PAGE } from "@/components/finance/pager";
import { LoadError, NoAccess } from "@/components/finance/states";

const TABS = {
  RAISED: "Waiting for approval",
  APPROVED: "Approved",
  PAID: "Paid",
  REJECTED: "Rejected",
} as const;
type Tab = keyof typeof TABS;
const STATUS: Record<Invoice["status"], { label: string; tone: "warning" | "info" | "success" | "danger" | "neutral" }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  RAISED: { label: "Waiting for approval", tone: "warning" },
  APPROVED: { label: "Approved · to pay", tone: "info" },
  PAID: { label: "Paid", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};
const GST_FILING: Record<Invoice["gstStatus"], string> = { PENDING: "GST not filed", SCHEDULED: "GST filing scheduled", COMPLETED: "GST filed" };
const GST_ACTION: Record<Invoice["gstStatus"], string> = { PENDING: "Mark GST not filed", SCHEDULED: "Mark GST filing scheduled", COMPLETED: "Mark GST filed" };
const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function InvoicesPage() {
  return (
    <AppShell active="invoices">
      <Invoices />
    </AppShell>
  );
}

/**
 * Creator-raised invoices (prototype S.invoices). Finance approves the ones that
 * match what was booked and pays them from Payouts. Approve is finance.approve,
 * reject is finance.pay (server routes); a planner reads their own plans' invoices.
 */
function Invoices() {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const allowed = !!user && user.role !== "CREATOR" && user.role !== "TEAM_MEMBER" && canUse(user, "finance.view");
  const token = allowed ? accessToken : null;
  const [tab, setTab] = useState<Tab>("RAISED");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Invoice | null>(null);
  const [rejecting, setRejecting] = useState<Invoice | null>(null);

  // Invoice-number search runs on the server; wait for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const list = useQuery({
    queryKey: ["invoices", "finance", tab, search, page],
    queryFn: () => invoicesApi.list(token!, { status: tab, search: search || undefined, page, pageSize: PER_PAGE }),
    enabled: !!token,
    placeholderData: keepPreviousData,
  });
  const counts = useQuery({
    queryKey: ["invoices", "finance", "counts", search],
    queryFn: async () => Object.fromEntries(await Promise.all((Object.keys(TABS) as Tab[]).map(async (k) => [k, (await invoicesApi.list(token!, { status: k, search: search || undefined, pageSize: 1 })).total] as const))) as Record<Tab, number>,
    enabled: !!token,
    placeholderData: keepPreviousData,
  });
  const lastPage = Math.max(1, Math.ceil((list.data?.total ?? 0) / PER_PAGE));
  useEffect(() => {
    if (list.data && page > lastPage) setPage(lastPage);
  }, [list.data, page, lastPage]);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["invoices"] }), qc.invalidateQueries({ queryKey: ["payments"] }), qc.invalidateQueries({ queryKey: ["links"] })]);
  const approve = useMutation({
    mutationFn: (inv: Invoice) => invoicesApi.approve(accessToken!, inv.id),
    onSuccess: async (_r, inv) => {
      await refresh();
      toast.success(`${inv.invoiceNumber} approved. Pay it from Payouts.`);
    },
    // The server re-checks bookings before approving; a refusal (e.g. a post now over booking) means this row is stale.
    onError: async (e) => {
      toast.error(errText(e, "Couldn't approve it. Try again."));
      await refresh();
    },
  });
  const gst = useMutation({
    mutationFn: ({ inv, status }: { inv: Invoice; status: Invoice["gstStatus"] }) => invoicesApi.updateGstStatus(accessToken!, inv.id, status),
    onSuccess: async (_r, { inv, status }) => {
      await qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(`${inv.invoiceNumber}: ${GST_FILING[status]}.`);
    },
    onError: (e) => toast.error(errText(e, "Couldn't update the GST filing.")),
  });
  const linksFile = useMutation({
    mutationFn: (inv: Invoice) => invoicesApi.downloadLinks(accessToken!, inv.id, inv.invoiceNumber),
    onError: (e) => toast.error(errText(e, "Couldn't download the links.")),
  });
  const pdf = useMutation({
    mutationFn: (inv: Invoice) => invoicesApi.downloadPdf(accessToken!, inv.id, inv.invoiceNumber),
    onError: (e) => toast.error(errText(e, "Couldn't download the PDF.")),
  });

  if (!allowed) return <NoAccess what="invoices" hint="Ask an admin to give you the Finance “view” permission if you need it." />;
  const canApprove = hasAccess(user, "finance.approve");
  const canReject = hasAccess(user, "finance.pay");
  const canPay = hasAccess(user, "finance.pay");
  const canEditGst = hasAccess(user, "finance.edit");
  // A planner's PDF check goes by the invoice's own campaign tag (server getInvoiceDetail), so a multi-row invoice would 404.
  const canPdf = (inv: Invoice) => user?.role !== "PLAN_MAKER" || !!inv.campaignId;
  const stale = list.isPlaceholderData;
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const openRow = open ? (rows.find((r) => r.id === open.id) ?? open) : null;

  return (
    <div className="workspace-page">
      <div className="page-heading">
        <div className="page-heading-copy">
          <p className="page-eyebrow">Finance</p>
          <h1 className="text-display">Invoices</h1>
          <p className="mt-1 text-body text-muted-foreground">Invoices creators raise for their posts. Approve the ones that match what was booked, then pay them from Payouts.</p>
        </div>
      </div>

      <Card className="ledger-panel">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as Tab);
            setPage(1);
          }}
        >
          <div className="tab-shelf flex items-end gap-4">
            <TabsList className="flex-1 border-b-0">
              {(Object.keys(TABS) as Tab[]).map((k) => (
                <TabsTrigger key={k} value={k}>
                  {TABS[k]}
                  {counts.data ? ` (${counts.data[k]})` : ""}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
        <div className="filter-bar">
          <SearchField label="Search invoices" placeholder="Search invoice number..." className="w-full sm:w-72" maxLength={60} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        {list.isError ? (
          <LoadError onRetry={() => list.refetch()} what="invoices" />
        ) : list.isLoading ? (
          <div className="flex flex-col gap-2 border-t p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="border-t">
            <EmptyState name={search ? "empty-search" : "empty-dues"} title={search ? `No invoice matches “${search}”` : `Nothing ${tab === "RAISED" ? "waiting for approval" : `in ${TABS[tab]}`}`}>
              {search ? "Check the number and try again." : tab === "RAISED" ? "Creators' new invoices show up here." : null}
            </EmptyState>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Creator</TableHead>
                <TableHead>Posts</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
                <TableHead className="text-right">GST</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody aria-busy={list.isFetching} className={stale ? "opacity-60" : undefined}>
              {rows.map((inv) => {
                const posts = inv.items?.length ?? 0;
                const over = inv.overQuotaCount ?? 0;
                const st = STATUS[inv.status];
                return (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <button type="button" onClick={() => setOpen(inv)} className="flex flex-col items-start text-left text-foreground hover:text-brand-ink">
                        <span className="text-body-strong">{inv.invoiceNumber}</span>
                        <span className="text-small text-fg-muted">Raised {day(inv.createdAt)}</span>
                      </button>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <UserAvatar name={personLabel(inv.creator, "Creator")} size="sm" />
                        <span className="font-medium">{personLabel(inv.creator, "Creator")}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {plural(posts, "post")}
                      {inv.campaign ? ` · ${inv.campaign.title}` : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={inv.subtotal} />
                    </TableCell>
                    <TableCell className="text-right">{inv.isGstInvoice ? (
                        <span className="flex flex-col items-end">
                          <Money value={inv.gstAmount} />
                          <span className="text-small text-fg-muted">{GST_FILING[inv.gstStatus]}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}</TableCell>
                    <TableCell className="text-right font-semibold">
                      <Money value={inv.amount} />
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-col items-start gap-1">
                        {over > 0 && inv.status !== "REJECTED" && inv.status !== "PAID" ? <StatusPill tone="danger">{plural(over, "post")} over booking</StatusPill> : <StatusPill tone={st.tone}>{st.label}</StatusPill>}
                        {inv.status === "REJECTED" && inv.remarks && <span className="max-w-48 truncate text-small text-fg-muted">{inv.remarks}</span>}
                        {inv.overdueDays > 0 && (inv.status === "APPROVED" || inv.status === "RAISED") && <span className="text-small text-danger-helper">{plural(inv.overdueDays, "day")} past due</span>}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center gap-2">
                        {canReject && inv.status === "RAISED" && (
                          <Button size="sm" variant="outline" disabled={stale} onClick={() => setRejecting(inv)}>
                            Reject…
                          </Button>
                        )}
                        {canApprove && inv.status === "RAISED" && over === 0 && (
                          <Button size="sm" disabled={approve.isPending || stale} onClick={() => approve.mutate(inv)}>
                            Approve
                          </Button>
                        )}
                        {canPay && inv.status === "APPROVED" && over === 0 && (
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/finance/payouts/${inv.creatorId}?invoice=${inv.id}`} aria-label={`Pay ${inv.invoiceNumber}`}>Pay</Link>
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`More for ${inv.invoiceNumber}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setOpen(inv)}>
                              <FileText className="h-4 w-4" aria-hidden />
                              See posts
                            </DropdownMenuItem>
                            {canPdf(inv) && (
                              <DropdownMenuItem onSelect={() => pdf.mutate(inv)}>
                                <Download className="h-4 w-4" aria-hidden />
                                Download PDF
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onSelect={() => linksFile.mutate(inv)}>
                              <Link2 className="h-4 w-4" aria-hidden />
                              Download post links
                            </DropdownMenuItem>
                            {inv.attachment?.url && (
                              <DropdownMenuItem asChild>
                                <a href={inv.attachment.url} target="_blank" rel="noreferrer">
                                  <Paperclip className="h-4 w-4" aria-hidden />
                                  Creator&apos;s own invoice
                                </a>
                              </DropdownMenuItem>
                            )}
                            {canReject && inv.status === "APPROVED" && <DropdownMenuItem onSelect={() => setRejecting(inv)}>Reject…</DropdownMenuItem>}
                            {canEditGst && inv.isGstInvoice && inv.status !== "REJECTED" && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-label text-muted-foreground">GST filing</DropdownMenuLabel>
                                {(["PENDING", "SCHEDULED", "COMPLETED"] as const)
                                  .filter((g) => g !== inv.gstStatus)
                                  .map((g) => (
                                    <DropdownMenuItem key={g} onSelect={() => gst.mutate({ inv, status: g })}>
                                      {GST_ACTION[g]}
                                    </DropdownMenuItem>
                                  ))}
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {total > 0 && <Pager total={total} page={Math.min(page, lastPage)} pages={lastPage} noun="invoices" onPage={setPage} />}
      </Card>

      <InvoiceSheet invoice={openRow} canReject={canReject} onClose={() => setOpen(null)} />
      <RejectDialog invoice={rejecting} onClose={() => setRejecting(null)} onDone={refresh} />
    </div>
  );
}

/** The posts on one invoice, with the over-booking flag that blocks approval. */
function InvoiceSheet({ invoice, canReject, onClose }: { invoice: Invoice | null; canReject: boolean; onClose: () => void }) {
  return (
    <Sheet open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        {invoice && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="text-section">{invoice.invoiceNumber}</SheetTitle>
              <SheetDescription>
                {personLabel(invoice.creator, "Creator")} · raised {day(invoice.createdAt)}
                {invoice.campaign ? ` · ${invoice.campaign.title}` : ""}
              </SheetDescription>
            </SheetHeader>
            {(invoice.overQuotaCount ?? 0) > 0 && invoice.status === "RAISED" && (
              <p className="rounded-md bg-danger-soft px-3 py-2 text-small text-danger-fg">
                {plural(invoice.overQuotaCount ?? 0, "post")} on this invoice {invoice.overQuotaCount === 1 ? "is" : "are"} beyond what the campaign booked. It can&apos;t be approved; {canReject ? "reject it" : "ask someone with Finance pay access to reject it"} so the creator raises it again with only the booked posts.
              </p>
            )}
            <ul className="flex flex-col divide-y rounded-card border">
              {(invoice.items ?? []).map((it) => (
                <li key={it.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <a href={it.link.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-body-strong">
                      {formatLabel(it.link.format)}
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    </a>
                    <span className="block truncate text-small text-fg-muted">{it.link.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                  </span>
                  {it.link.overQuota && <StatusPill tone="danger">Over booking</StatusPill>}
                  <Money value={it.amount} className="font-semibold" />
                </li>
              ))}
            </ul>
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
            <section aria-labelledby="inv-file" className="flex flex-col gap-2">
              <h3 id="inv-file" className="text-card-title">
                Creator&apos;s invoice file
              </h3>
              <InvoiceAttachmentField invoice={invoice} />
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RejectDialog({ invoice, onClose, onDone }: { invoice: Invoice | null; onClose: () => void; onDone: () => Promise<unknown> }) {
  const { accessToken } = useAuth();
  const [reason, setReason] = useState("");
  const reject = useMutation({
    mutationFn: () => invoicesApi.reject(accessToken!, invoice!.id, reason.trim()),
    onSuccess: async () => {
      await onDone();
      toast.success(`${invoice!.invoiceNumber} rejected. Its booked posts go back to the creator to invoice again.`);
      close();
    },
  });
  function close() {
    setReason("");
    reject.reset();
    onClose();
  }
  return (
    <Dialog
      open={!!invoice}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject {invoice?.invoiceNumber}?</DialogTitle>
          <DialogDescription>The creator sees your reason. Its posts go back to them so they can raise a corrected invoice.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reject-reason">Reason</Label>
          <Input id="reject-reason" maxLength={500} placeholder="e.g. One post is over the booking. Raise it again without it." value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {reject.isError && (
          <p className="text-small text-danger-helper" role="alert">
            {errText(reject.error, "Couldn't reject it. Try again.")}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Keep it
          </Button>
          <Button variant="destructive" disabled={!reason.trim() || reject.isPending} onClick={() => reject.mutate()}>
            Reject invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
