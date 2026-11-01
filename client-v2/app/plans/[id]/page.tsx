"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Copy, Pencil, Download, FileSpreadsheet, FileText, Trash2, TriangleAlert } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, plans as plansApi, type Plan, type SheetFormat } from "@/lib/api-client";
import { budgetLeft, canApprovePlan, canBeApproved, canEditPlan, canViewPlans, formatName, isDecidable, isDraft, isEditablePlan, lineClientTotal, margin, perPostClient, PLAN_STATUS, sheetFormatOf } from "@/lib/plans";
import { SheetFormatPicker } from "@/components/plans/sheet-format-picker";
import { ExecutionSheetCard } from "@/components/plans/execution-sheet-card";
import { SourceSheetCard } from "@/components/plans/source-sheet-card";
import { ClientInvoiceDialog } from "@/components/plans/client-invoice-dialog";
import { invalidateAfterPlanChange, usePlan, usePlans } from "@/lib/queries/plans";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money } from "@/components/taggify/money";
import { ProgressBar } from "@/components/taggify/progress-meter";
import { PlatformIcon } from "@/components/taggify/platform-icon";
import { StatusPill } from "@/components/taggify/status-pill";
import { audienceLabel, displayHandle, PageAvatar } from "@/components/finance/identity";
import { LoadError, NoAccess } from "@/components/finance/states";
import { Illustration } from "@/components/taggify/illustration";
import { PlanInvoiceAttachmentField } from "@/components/finance/invoice-attachment";

export default function PlanDetailPage() {
  return (
    <AppShell active="plans">
      <PlanDetail />
    </AppShell>
  );
}

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

function PlanDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const plan = usePlan(id);
  const all = usePlans();
  const [confirm, setConfirm] = useState<"approve" | "reject" | "delete" | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  const decide = useMutation({
    mutationFn: (kind: "approve" | "reject") => (kind === "approve" ? plansApi.approve(accessToken!, id) : plansApi.reject(accessToken!, id)),
    onSuccess: async (p, kind) => {
      setConfirm(null);
      await invalidateAfterPlanChange(qc);
      toast.success(kind === "approve" ? `Plan approved. Campaign “${p.name}” created.` : "Plan rejected.");
    },
  });
  const remove = useMutation({
    mutationFn: () => plansApi.remove(accessToken!, id),
    onSuccess: async () => {
      await invalidateAfterPlanChange(qc);
      toast.success("Draft deleted.");
      router.push("/plans");
    },
  });
  // "Client sheet" first asks which of the two layouts to use (16 Oct); the pick travels with the generate call.
  const [clientSheetOpen, setClientSheetOpen] = useState(false);
  const sheet = useMutation({
    mutationFn: ({ kind, sheetFormat }: { kind: "client" | "internal"; sheetFormat?: SheetFormat }) => plansApi.generateSheet(accessToken!, id, kind, sheetFormat),
    onSuccess: async (r) => {
      // Open first: after the awaited refetch the browser no longer counts this as the click, and may block the tab.
      window.open(r.spreadsheetUrl, "_blank", "noopener");
      await invalidateAfterPlanChange(qc);
      setClientSheetOpen(false);
      if (r.shareError) toast.warning(r.shareError);
      else if (r.sharedWith) toast.success(`Sheet ready. ${r.sharedWith} can edit it.`);
    },
    onError: (e) => toast.error(errText(e, "Couldn't create the sheet. Try again.")),
  });

  if (!canViewPlans(user)) return <NoAccess what="plans" />;
  if (plan.isLoading) return <Skeleton className="mt-6 h-96 w-full rounded-card" />;
  if (plan.isError || !plan.data) return <LoadError onRetry={() => plan.refetch()} what="this plan" />;

  const p = plan.data;
  const st = PLAN_STATUS[p.status];
  const editable = canEditPlan(user, p);
  // A draft can be approved or rejected; a rejected plan can still be approved (8 Oct).
  const approvable = canApprovePlan(user, p) && canBeApproved(p);
  const rejectable = canApprovePlan(user, p) && isDecidable(p);
  const siblings = p.pitchGroupId ? (all.data ?? []).filter((x) => x.pitchGroupId === p.pitchGroupId).sort((a, b) => a.variantLabel.localeCompare(b.variantLabel)) : [];
  const pages = new Set(p.items.map((i) => i.assetId)).size;
  // Plans saved by the plan form quote one overall total, so their lines carry cost only.
  const perLineClient = p.items.some((i) => i.clientCost != null);

  return (
    <div className="workspace-page">
      <Link href="/plans" className="inline-flex items-center gap-2 self-start text-body-strong text-foreground hover:text-brand-ink">
        <ArrowLeft className="h-[18px] w-[18px]" aria-hidden />
        Back to Plans
      </Link>

      <div className="page-heading detail-heading">
        <div className="page-heading-copy">
          <p className="page-eyebrow">
            {p.clientName} · {p.variantLabel}
          </p>
          <h1 className="text-display">{p.name}</h1>
          <p className="mt-1 text-body text-muted-foreground">
            By {p.createdBy?.name ?? "—"} · updated {new Date(p.updatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
            {p.approvedBy && ` · ${p.status === "APPROVED" ? "approved" : "decided"} by ${p.approvedBy.name}`}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <StatusPill tone={st.tone}>{st.label}</StatusPill>
          {editable ? (
            <Button variant="outline" disabled={sheet.isPending} onClick={() => setClientSheetOpen(true)} data-testid="client-sheet-button">
              <FileSpreadsheet />
              {p.clientSheetUrl ? "Client sheet" : "Create client sheet"}
            </Button>
          ) : (
            p.clientSheetUrl && (
              <Button asChild variant="outline">
                <a href={p.clientSheetUrl} target="_blank" rel="noreferrer">
                  <FileSpreadsheet />
                  Client sheet
                </a>
              </Button>
            )
          )}
          {p.internalSheetUrl ? (
            <Button asChild variant="outline">
              <a href={p.internalSheetUrl} target="_blank" rel="noreferrer">
                Internal sheet
              </a>
            </Button>
          ) : (
            editable && (
              <Button variant="outline" disabled={sheet.isPending} onClick={() => sheet.mutate({ kind: "internal" })}>
                Create internal sheet
              </Button>
            )
          )}
          <Button variant="outline" onClick={() => plansApi.downloadPdf(accessToken!, p.id, p.name).catch(() => toast.error("Couldn't download the PDF."))}>
            <Download />
            PDF
          </Button>
          {editable && isEditablePlan(p) && (
            <Button asChild variant="outline">
              <Link href={`/plans/${p.id}/edit`}>
                <Pencil />
                Edit plan
              </Link>
            </Button>
          )}
          {editable && (
            <Button asChild variant="outline">
              <Link href={`/plans/new?variantOf=${p.id}`}>
                <Copy />
                New variant
              </Link>
            </Button>
          )}
        </div>
      </div>

      <ClientSheetDialog plan={p} open={clientSheetOpen} busy={sheet.isPending} onOpenChange={(o) => !sheet.isPending && setClientSheetOpen(o)} onGenerate={(sheetFormat) => sheet.mutate({ kind: "client", sheetFormat })} />
      {(p.inactivePages?.length ?? 0) > 0 && (
        <p role="status" className="flex items-start gap-2 rounded-md bg-warning-soft px-4 py-3 text-small text-warning-fg" data-testid="plan-inactive-pages">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {p.inactivePages!.length === 1 ? "1 page on this plan is" : `${p.inactivePages!.length} pages on this plan are`} no longer available in Inventory: {p.inactivePages!.map((x) => `@${x.handle}`).join(", ")}.
            {editable && isEditablePlan(p) ? " Edit the plan to swap them out before sharing." : ""}
          </span>
        </p>
      )}

      {siblings.length > 1 && (
        <nav aria-label="Plan variants" className="flex flex-wrap items-center gap-2">
          {siblings.map((s) => (
            <Button key={s.id} asChild size="sm" variant={s.id === p.id ? "default" : "outline"}>
              <Link href={`/plans/${s.id}`} aria-current={s.id === p.id ? "page" : undefined}>
                {s.variantLabel} · <Money value={s.overview.subtotal} />
              </Link>
            </Button>
          ))}
          {/* Every variant in one PDF, to send the client the options side by side. */}
          <Button size="sm" variant="ghost" onClick={() => plansApi.downloadGroupPdf(accessToken!, p.pitchGroupId!, `${p.name}-all-variants`).catch(() => toast.error("Couldn't download the PDF."))}>
            <Download />
            PDF of all variants
          </Button>
        </nav>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_var(--rail-width)]">
        <Card className="ledger-panel">
          <div className="panel-heading">
            <h2 className="text-card-title">Pages and deliverables</h2>
            <span className="ml-auto text-small text-muted-foreground">
              {pages} pages · {p.overview.totalPosts} posts{perLineClient ? " · cost vs client price" : ""}
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Page</TableHead>
                <TableHead>Format</TableHead>
                <TableHead className="text-right">Posts</TableHead>
                <TableHead className="text-right">Cost / post</TableHead>
                {perLineClient ? (
                  <>
                    <TableHead className="text-right">Client / post</TableHead>
                    <TableHead className="text-right">Client total</TableHead>
                  </>
                ) : (
                  <TableHead className="text-right">Line cost</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <span className="flex items-center gap-3">
                      <PageAvatar assetId={i.assetId} handle={i.asset?.handle ?? "page"} size="sm" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1 text-body-strong">
                          <PlatformIcon platform={i.asset?.platform ?? "instagram"} size={16} />
                          {displayHandle(i.asset?.handle ?? "—", i.asset?.platform)}
                        </span>
                        <span className="block text-small text-fg-muted">
                          {audienceLabel(i.asset?.followers, i.asset?.platform)}
                          {i.asset?.category ? ` · ${i.asset.category}` : ""}
                        </span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {formatName(i.format)}
                    {i.comboSplit && (
                      <span className="block text-small text-muted-foreground">
                        {Object.entries(i.comboSplit).map(([part, amount], n) => (
                          <span key={part}>
                            {n > 0 ? " + " : ""}
                            {formatName(part)} <Money value={amount} />
                          </span>
                        ))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="num text-right">{i.postsPerProfile}</TableCell>
                  <TableCell className="text-right">
                    <Money value={i.cost} />
                  </TableCell>
                  {perLineClient ? (
                    <>
                      <TableCell className="text-right">
                        <Money value={perPostClient(i)} />
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        <Money value={lineClientTotal(i)} />
                      </TableCell>
                    </>
                  ) : (
                    <TableCell className="text-right font-semibold">
                      <Money value={Number(i.cost) * i.postsPerProfile} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {p.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={perLineClient ? 6 : 5} className="h-24 text-center text-muted-foreground">
                    No pages on this plan yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        {/* The rail stays in view and scrolls on its own, so a short page list never leaves half the screen empty. */}
        <div className="thin-scroll flex flex-col gap-4 xl:sticky xl:top-[calc(var(--topbar-height)+1rem)] xl:max-h-[calc(100vh-var(--topbar-height)-3rem)] xl:overflow-y-auto xl:pb-1">
          <BudgetCard plan={p} />
          <SourceSheetCard plan={p} editable={editable} />

          <Card className="form-panel p-6">
            <h2 className="mb-1 text-card-title">Decision</h2>
            {p.status === "APPROVED" ? (
              <div className="flex flex-col gap-3">
                <Illustration name="partnership-01" className="mx-auto h-28 w-auto" />
                <p className="text-small text-muted-foreground">Approved. The campaign is live for every page on this plan.</p>
                {p.campaignId && (
                  <Button asChild>
                    <Link href={`/campaigns/${p.campaignId}`}>Open campaign</Link>
                  </Button>
                )}
              </div>
            ) : approvable ? (
              <>
                <p className="mb-3 text-small text-muted-foreground">
                  {p.status === "REJECTED" ? "Rejected. You can still approve it: " : ""}
                  {p.items.length ? "Approving creates the campaign and shows it to every page's owner." : "Add pages before approving. A plan with no pages creates no campaign."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={p.items.length === 0} onClick={() => setConfirm("approve")}>
                    Approve plan
                  </Button>
                  {rejectable && (
                    <Button variant="outline" className="text-danger-fg" onClick={() => setConfirm("reject")}>
                      Reject
                    </Button>
                  )}
                </div>
              </>
            ) : p.status === "REJECTED" ? (
              <p className="text-small text-muted-foreground">Rejected. Only an admin or the plan&apos;s own planner can approve it now.</p>
            ) : (
              <p className="text-small text-muted-foreground">Waiting for an approver. Only an admin or the plan&apos;s own planner can decide.</p>
            )}
            {isDraft(p) && editable && (
              <Button variant="ghost" size="sm" className="mt-3 px-1 text-danger-fg" onClick={() => setConfirm("delete")}>
                <Trash2 />
                Delete draft
              </Button>
            )}
          </Card>

          <ClientCard plan={p} editable={editable} onInvoice={() => setInvoiceOpen(true)} />
          <ExecutionSheetCard plan={p} editable={editable} />
        </div>
      </div>

      <Dialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (!o) {
            setConfirm(null);
            decide.reset();
            remove.reset();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "approve" ? "Approve this plan?" : confirm === "reject" ? "Reject this plan?" : "Delete this draft?"}</DialogTitle>
            <DialogDescription>
              {confirm === "approve"
                ? `A campaign is created from its ${pages} pages and each page's owner sees it straight away. This can't be undone.`
                : confirm === "reject"
                  ? "The plan stays on record as rejected. You can make a new variant to pitch again."
                  : "The draft and its page list are removed for good."}
            </DialogDescription>
          </DialogHeader>
          {(decide.isError || remove.isError) && (
            <p className="text-small text-danger-helper" role="alert">
              {errText(decide.error ?? remove.error, "That didn't go through. Try again.")}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            {confirm === "delete" ? (
              <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                Delete draft
              </Button>
            ) : (
              <Button variant={confirm === "reject" ? "destructive" : "default"} disabled={decide.isPending} onClick={() => confirm && decide.mutate(confirm as "approve" | "reject")}>
                {confirm === "approve" ? "Approve plan" : "Reject plan"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClientInvoiceDialog plan={p} open={invoiceOpen} onOpenChange={setInvoiceOpen} />
    </div>
  );
}

/**
 * Budget at a glance (design-fix 2nd check #1): what the client pays is the
 * headline, a bar shows the plan against the client's budget, the client-facing
 * lines sit under it in smaller type, and the internal numbers (cost, margin)
 * are their own block so they don't read as part of the client's bill.
 */
function BudgetCard({ plan: p }: { plan: Plan }) {
  const budget = p.budget ? Number(p.budget) : null;
  const left = budgetLeft(p);
  const m = margin(p);
  const paid = p.overview.taxable ?? p.overview.subtotal;
  const marginPct = paid > 0 ? Math.round((m / paid) * 100) : null;
  const over = left !== null && left < 0;
  return (
    <Card className="summary-panel flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-small font-semibold text-muted-foreground">Client pays</h2>
        <p className="mt-1 text-h2 font-bold">
          <Money value={p.overview.total} />
        </p>
        <p className="text-small text-muted-foreground">{p.gstPercent ? `Includes ${p.gstPercent}% GST` : "No GST on this plan"}</p>
      </div>

      {budget !== null ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-baseline justify-between gap-2 text-small">
            <span className="text-muted-foreground">Internal budget</span>
            <span className={cn("whitespace-nowrap font-semibold", over ? "text-danger-fg" : "text-success-fg")}>
              <Money value={Math.abs(left ?? 0)} /> {over ? "over" : "left"}
            </span>
          </p>
          <ProgressBar value={p.totalCost} max={budget} label="Spent on pages against the internal budget" />
          <p className="text-caption text-muted-foreground">
            <Money value={p.totalCost} /> of <Money value={budget} /> spent on pages
          </p>
        </div>
      ) : (
        <p className="rounded-md bg-muted px-3 py-2 text-small text-muted-foreground">No budget set.</p>
      )}

      <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-small">
        <dt className="text-muted-foreground">Plan total</dt>
        <dd className="text-right font-medium">
          <Money value={p.overview.subtotal} />
        </dd>
        {p.overview.discount > 0 && (
          <>
            <dt className="text-muted-foreground">Discount</dt>
            <dd className="text-right font-medium text-success-fg">
              − <Money value={p.overview.discount} />
            </dd>
            <dt className="text-muted-foreground">After discount</dt>
            <dd className="text-right font-medium">
              <Money value={p.overview.taxable} />
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">GST{p.gstPercent ? ` (${p.gstPercent}%)` : ""}</dt>
        <dd className="text-right font-medium">{p.gstPercent ? <Money value={p.overview.gstAmount} signed /> : "None"}</dd>
      </dl>

      <div className="rounded-md bg-muted px-3 py-3">
        <p className="mb-2 text-micro font-semibold uppercase text-muted-foreground">Internal</p>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-small">
          <dt className="text-muted-foreground">Cost to pages</dt>
          <dd className="text-right font-medium">
            <Money value={p.totalCost} />
          </dd>
          <dt className="text-muted-foreground">Margin</dt>
          <dd className={cn("text-right font-semibold", m >= 0 ? "text-success-fg" : "text-danger-fg")}>
            <Money value={m} />
            {marginPct !== null && <span className="ml-1 font-normal text-muted-foreground">({marginPct}%)</span>}
          </dd>
        </dl>
      </div>
    </Card>
  );
}

/**
 * The dialog "Client sheet" opens (16 Oct — "user clicked client sheet, it asks
 * which format"): the two layouts, then Generate. A sheet already generated in
 * the chosen format is opened as is; a different pick regenerates it.
 */
function ClientSheetDialog({ plan: p, open, busy, onOpenChange, onGenerate }: { plan: Plan; open: boolean; busy: boolean; onOpenChange: (o: boolean) => void; onGenerate: (format: SheetFormat) => void }) {
  const current = sheetFormatOf(p);
  const [choice, setChoice] = useState<SheetFormat>(current);
  useEffect(() => {
    if (open) setChoice(current);
  }, [open, current]);
  const sameAsExisting = !!p.clientSheetUrl && choice === current;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="client-sheet-dialog">
        <DialogHeader>
          <DialogTitle>Client sheet format</DialogTitle>
          <DialogDescription>Pick how the overview is laid out in the client&apos;s Google Sheet. Pages go in one tab per category either way.{p.clientSheetUrl ? " A different format rewrites the sheet that already exists." : ""}</DialogDescription>
        </DialogHeader>
        <SheetFormatPicker value={choice} onChange={setChoice} disabled={busy} />
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <span className="flex flex-wrap gap-2">
            {sameAsExisting && (
              <Button asChild variant="outline">
                <a href={p.clientSheetUrl!} target="_blank" rel="noreferrer" data-testid="client-sheet-open-existing">
                  Open sheet as is
                </a>
              </Button>
            )}
            <Button disabled={busy} onClick={() => onGenerate(choice)} data-testid="client-sheet-generate">
              {busy ? "Generating…" : p.clientSheetUrl ? (sameAsExisting ? "Regenerate" : "Regenerate in this format") : "Generate client sheet"}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function ClientCard({ plan: p, editable, onInvoice }: { plan: Plan; editable: boolean; onInvoice: () => void }) {
  const { accessToken } = useAuth();
  return (
    <Card className="form-panel p-6">
      <h2 className="mb-3 text-card-title">Client</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
        <dt className="text-muted-foreground">Name</dt>
        <dd className="text-right font-semibold">{p.clientName}</dd>
        {p.clientCompany && (
          <>
            <dt className="text-muted-foreground">Company</dt>
            <dd className="text-right font-semibold">{p.clientCompany}</dd>
          </>
        )}
        {p.clientGstNumber && (
          <>
            <dt className="text-muted-foreground">GSTIN</dt>
            <dd className="text-right font-semibold">{p.clientGstNumber}</dd>
          </>
        )}
        {p.clientContact && (
          <>
            <dt className="text-muted-foreground">Contact</dt>
            <dd className="text-right font-semibold">{p.clientContact}</dd>
          </>
        )}
      </dl>
      {p.notes && <p className="mt-3 rounded-md bg-muted p-3 text-small text-fg-strong">{p.notes}</p>}
      <div className="mt-4 flex flex-col gap-2 border-t pt-4">
        <p className="text-body-strong">Client invoice</p>
        {p.status !== "APPROVED" ? (
          <p className="text-small text-muted-foreground">Available once the plan is approved.</p>
        ) : p.clientInvoiceNumber ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body">{p.clientInvoiceNumber}</span>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => plansApi.downloadClientInvoicePdf(accessToken!, p.id, p.clientInvoiceNumber).catch(() => toast.error("Couldn't download the invoice."))}>
              <Download />
              PDF
            </Button>
            {editable && (
              <Button size="sm" variant="ghost" onClick={onInvoice}>
                Edit details
              </Button>
            )}
          </div>
        ) : editable ? (
          <Button size="sm" variant="outline" className="self-start" onClick={onInvoice}>
            <FileText />
            Generate client invoice
          </Button>
        ) : (
          <p className="text-small text-muted-foreground">Not generated yet.</p>
        )}
        {/* A client invoice raised outside Taggify, at any plan status (server plans/service.js invoiceAttachmentFor). */}
        {(p.invoiceAttachment || editable) && (
          <div className="flex flex-col gap-2 pt-2">
            <p className="text-small text-muted-foreground">Client invoice PDF</p>
            <PlanInvoiceAttachmentField plan={p} editable={editable} />
          </div>
        )}
      </div>
    </Card>
  );
}
