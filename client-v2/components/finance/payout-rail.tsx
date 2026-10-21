"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, CircleCheck, CreditCard, FileText, Upload, X } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, payments as paymentsApi, type BillingProfile, type PaymentInvoice, type Payout, type PendingLink } from "@/lib/api-client";
import { captionTitle, computePayoutTotals, formatLabel, latestSnapshot, receiptProblem, todayKey, TDS_RATES, uploadPayoutReceipt, type TdsRate } from "@/lib/finance";
import { money } from "@/lib/format";
import { invalidateAfterPayout } from "@/lib/queries/finance";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Illustration } from "@/components/taggify/illustration";
import { Money } from "@/components/taggify/money";
import { VerticalSteps } from "@/components/taggify/vertical-steps";
import { ContentThumb, displayHandle, PageAvatar } from "./identity";

const STEPS = ["Select dues", "Tax details", "Payment details", "Receipt"];

/** The payout may or may not have gone through; the user must check Paid before retrying. */
class OutcomeUnknownError extends Error {
  constructor() {
    super("We couldn't confirm whether this payout went through. Check the Paid tab before trying again.");
  }
}

export type SelectedDue = { key: string; kind: "link"; link: PendingLink; platform: string } | { key: string; kind: "invoice"; invoice: PaymentInvoice };

/**
 * The reference's right-hand payout rail: peach panel, 01–04 step list, white
 * card with the running total and one black CTA. Everything stays in the
 * browser until "Submit payout": that creates the payout (POST
 * /payments/payouts → DRAFT), uploads the receipt and confirms it (→ PAID).
 * If the upload fails the fresh draft is cancelled so its posts go straight
 * back to Dues. A draft left by an earlier failed/abandoned attempt can be
 * finished (receipt only) or cancelled from here.
 */
export function PayoutRail({
  vendorId,
  vendorName,
  selected,
  onRemove,
  onClear,
  billingProfile,
  billingError,
  drafts,
  className,
}: {
  vendorId: string;
  vendorName: string;
  selected: SelectedDue[];
  onRemove: (key: string) => void;
  onClear: () => void;
  billingProfile: BillingProfile | null;
  /** True when bank details couldn't be loaded — never claim "no bank details" then. */
  billingError?: boolean;
  drafts: Payout[];
  className?: string;
}) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [isGst, setIsGst] = useState(false);
  const [tds, setTds] = useState<TdsRate>(null);
  const [paidOn, setPaidOn] = useState(todayKey());
  const [utr, setUtr] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Payout | null>(null);
  const [done, setDone] = useState<Payout | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<Payout | null>(null);

  // Emptying the selection mid-flow sends you back to step 1.
  useEffect(() => {
    if (!draft && !done && selected.length === 0 && step > 0) setStep(0);
  }, [selected.length, draft, done, step]);

  const links = selected.flatMap((s) => (s.kind === "link" ? [s.link] : []));
  const invoices = selected.flatMap((s) => (s.kind === "invoice" ? [s.invoice] : []));
  const totals = draft
    ? { subtotal: Number(draft.subtotal), gstAmount: Number(draft.gstAmount), tdsAmount: Number(draft.tdsAmount), netAmount: Number(draft.netAmount) }
    : computePayoutTotals(
        links.map((l) => Number(l.cost)),
        isGst,
        tds,
        invoices
      );
  // What the step-1 list adds up to: posts at cost, invoices at their billed amount (GST included).
  const selectedSum = links.reduce((s, l) => s + Number(l.cost), 0) + invoices.reduce((s, i) => s + Number(i.amount), 0);
  const shownGst = draft ? draft.isGstInvoice || totals.gstAmount > 0 : isGst || totals.gstAmount > 0;
  const shownTds = draft ? (draft.tdsPercent ? Number(draft.tdsPercent) : null) : tds;
  const postCount = draft ? draft.items?.length ?? 0 : links.length + invoices.reduce((n, i) => n + i.links.length, 0);
  const campaignCount = draft
    ? new Set((draft.items ?? []).map((i) => i.link.campaign?.id)).size
    : new Set([...links.map((l) => l.campaignId), ...invoices.flatMap((i) => i.links.map((l) => l.campaign?.id))]).size;

  const submit = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Upload the payment receipt first.");
      if (draft) return uploadPayoutReceipt(accessToken!, draft.id, file, { paidOn, utr });
      const created = await paymentsApi.createPayout(accessToken!, {
        creatorId: vendorId,
        linkIds: links.map((l) => l.id),
        invoiceIds: invoices.map((i) => i.id),
        isGstInvoice: isGst,
        tdsPercent: tds,
      });
      try {
        return await uploadPayoutReceipt(accessToken!, created.id, file, { paidOn, utr });
      } catch (err) {
        // Never leave the posts locked on a payout with no receipt. If even the
        // cancel fails (e.g. the confirm actually went through and only the reply
        // was lost, so it's no longer a draft), don't claim nothing was paid.
        try {
          await paymentsApi.cancelPayout(accessToken!, created.id);
        } catch {
          await invalidateAfterPayout(qc);
          throw new OutcomeUnknownError();
        }
        throw err;
      }
    },
    onSuccess: async (payout) => {
      setDone(payout);
      onClear();
      await invalidateAfterPayout(qc);
      toast.success(`Payout submitted: ${money(payout.netAmount)} to ${vendorName}`);
    },
  });

  const cancelDraft = useMutation({
    mutationFn: (p: Payout) => paymentsApi.cancelPayout(accessToken!, p.id),
    onSuccess: async () => {
      setConfirmCancel(null);
      setDraft(null);
      setStep(0);
      await invalidateAfterPayout(qc);
      toast.success("Draft payout cancelled. Its posts are back in Dues.");
    },
  });

  function reset() {
    setDone(null);
    setDraft(null);
    setStep(0);
    setIsGst(false);
    setTds(null);
    setUtr("");
    setFile(null);
    setFileError(null);
    setPaidOn(todayKey());
    submit.reset();
  }

  function pickFile(next?: File) {
    if (!next) return;
    const problem = receiptProblem(next);
    setFileError(problem);
    if (!problem) setFile(next);
  }

  const summary = (
    <div className="overflow-hidden rounded-lg border text-small">
      <Row label="Base amount" value={<Money value={totals.subtotal} />} />
      <Row label={shownGst ? "GST (18%)" : "GST"} value={shownGst ? <Money value={totals.gstAmount} signed /> : "—"} />
      <Row label={shownTds ? `TDS (${shownTds}%)` : "TDS"} value={shownTds ? <Money value={-totals.tdsAmount} signed /> : "—"} />
      <div className="flex items-center justify-between bg-success-row px-3 py-3 font-bold text-success-fg">
        <span>Total payable</span>
        <Money value={totals.netAmount} className="text-card-title font-extrabold" />
      </div>
    </div>
  );

  const head = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-body font-bold">{draft ? "Payout waiting for receipt" : "Selected for payout"}</p>
        <p className="mt-1 text-small text-muted-foreground">
          {postCount} post{postCount === 1 ? "" : "s"} · {campaignCount} campaign{campaignCount === 1 ? "" : "s"}
        </p>
      </div>
      <Money value={step === 0 && !draft ? selectedSum : totals.netAmount} className="text-section" />
    </div>
  );

  const back = (to: number) => (
    <Button variant="ghost" size="sm" className="self-start px-1" onClick={() => setStep(to)} disabled={submit.isPending}>
      <ArrowLeft />
      Back
    </Button>
  );

  // Each Continue button disappears when clicked; keep keyboard focus in the rail.
  const cardRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    cardRef.current?.focus({ preventScroll: true });
  }, [step, done]);

  let body: React.ReactNode;
  if (done) {
    body = (
      <div className="flex flex-col items-center gap-2 py-1 text-center" role="status">
        <Illustration name="payout-success" className="h-32 w-auto" />
        <p className="text-section font-extrabold">Payout submitted</p>
        <p className="text-small text-muted-foreground">
          {money(done.netAmount)} paid to {vendorName}. They can now see it with the receipt.
        </p>
        <dl className="mt-2 grid w-full grid-cols-2 gap-y-1 text-left text-small">
          <dt className="text-muted-foreground">Posts</dt>
          <dd className="text-right font-semibold">{done.items?.length ?? postCount}</dd>
          <dt className="text-muted-foreground">Paid on</dt>
          <dd className="text-right font-semibold">{done.paidAt ? new Date(done.paidAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</dd>
          <dt className="text-muted-foreground">UTR</dt>
          <dd className="text-right font-semibold">{done.utr || "—"}</dd>
        </dl>
        <Button size="lg" className="mt-3 w-full" onClick={reset}>
          Back to dues
        </Button>
      </div>
    );
  } else if (step === 0) {
    body = (
      <>
        {head}
        {selected.length === 0 ? (
          <p className="py-3 text-center text-small text-muted-foreground">Tick dues in the table to add them to this payout.</p>
        ) : (
          <ul className="flex max-h-[280px] flex-col gap-3 overflow-y-auto">
            {selected.map((s) => (
              <li key={s.key} className="grid grid-cols-[40px_24px_minmax(0,1fr)_auto_32px] items-center gap-2">
                {s.kind === "link" ? (
                  <>
                    <ContentThumb src={latestSnapshot(s.link)?.thumbnailUrl} format={s.link.format} />
                    <PageAvatar assetId={s.link.asset.id} handle={s.link.asset.handle} size="xs" />
                    <span className="min-w-0">
                      <span className="block truncate text-small font-medium">{captionTitle(latestSnapshot(s.link)?.caption) ?? `${formatLabel(s.link.format)} · ${s.link.campaign?.title ?? ""}`}</span>
                      <span className="block truncate text-caption text-fg-muted">{displayHandle(s.link.asset.handle, s.platform)}</span>
                    </span>
                    <Money value={s.link.cost} className="text-small font-bold" />
                  </>
                ) : (
                  <>
                    <span className="grid h-control w-control place-items-center rounded-sm bg-brand-soft text-brand-ink">
                      <FileText className="h-4 w-4" aria-hidden />
                    </span>
                    <span />
                    <span className="min-w-0">
                      <span className="block truncate text-small font-medium">Invoice {s.invoice.invoiceNumber}</span>
                      <span className="block truncate text-caption text-fg-muted">{s.invoice.links.length} posts</span>
                    </span>
                    <Money value={s.invoice.amount} className="text-small font-bold" />
                  </>
                )}
                <button type="button" className="grid h-8 w-8 place-items-center rounded-sm text-fg-muted hover:bg-muted hover:text-foreground" aria-label={`Remove ${s.kind === "link" ? captionTitle(latestSnapshot(s.link)?.caption) ?? s.link.campaign?.title ?? "post" : `invoice ${s.invoice.invoiceNumber}`} from payout`} onClick={() => onRemove(s.key)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button size="lg" className="w-full" disabled={selected.length === 0} onClick={() => setStep(1)}>
          Continue to Tax Details
          <ArrowRight />
        </Button>
      </>
    );
  } else if (step === 1) {
    const hasLinks = links.length > 0;
    body = (
      <>
        {head}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-small font-semibold">
            GST <span className="font-medium text-fg-muted">(18% of the posts&apos; base, or none)</span>
          </legend>
          <Choice
            options={[
              { label: "No GST", value: "0" },
              { label: "Add GST 18%", value: "1" },
            ]}
            value={isGst ? "1" : "0"}
            onChange={(v) => setIsGst(v === "1")}
            disabled={!hasLinks}
            name="GST"
          />
          {invoices.length > 0 && <p className="text-caption text-muted-foreground">Raised invoices keep the GST they were raised with.</p>}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-small font-semibold">
            TDS <span className="font-medium text-fg-muted">(withheld from the base)</span>
          </legend>
          <Choice
            options={[{ label: "None", value: "0" }, ...TDS_RATES.map((r) => ({ label: `${r}%`, value: String(r) }))]}
            value={String(tds ?? 0)}
            onChange={(v) => setTds(v === "0" ? null : (Number(v) as TdsRate))}
            name="TDS"
          />
        </fieldset>
        {summary}
        <Button size="lg" className="w-full" onClick={() => setStep(2)}>
          Continue to Payment Details
          <ArrowRight />
        </Button>
        {back(0)}
      </>
    );
  } else if (step === 2) {
    body = (
      <>
        {head}
        <div className="flex flex-col gap-2">
          <p className="text-small font-semibold">
            Pay to <span className="font-medium text-fg-muted">· bank transfer (NEFT/IMPS)</span>
          </p>
          {billingProfile ? (
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-muted text-fg-strong">
                <CreditCard className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <div className="min-w-0 text-small">
                <p className="truncate font-semibold">{billingProfile.name}</p>
                <p className="text-muted-foreground">•••• {billingProfile.bankAccountNumber.slice(-4)}</p>
                <p className="text-muted-foreground">IFSC {billingProfile.ifscCode}</p>
              </div>
            </div>
          ) : null}
          {billingError ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-small text-muted-foreground">Couldn&apos;t load the bank details. Check them in Billing Details before you transfer.</p>
          ) : (!billingProfile || billingProfile.approvalStatus !== "approved") && (
            <p className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-caption text-warning-fg">
              <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden />
              {billingProfile ? "These bank details aren't approved yet. Check them with the vendor before you transfer." : "This vendor has no bank details on file. Ask them to add a billing profile before you transfer."}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="payout-date">Payment date</Label>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
            <Input id="payout-date" type="date" className="pl-9" value={paidOn} max={todayKey()} onChange={(e) => setPaidOn(e.target.value || todayKey())} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="payout-utr">
            UTR / reference no. <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="payout-utr" maxLength={60} placeholder="e.g. UTR82374923" value={utr} onChange={(e) => setUtr(e.target.value)} />
        </div>
        <Button size="lg" className="w-full" onClick={() => setStep(3)}>
          Continue to Receipt
          <ArrowRight />
        </Button>
        {draft ? (
          <Button
            variant="ghost"
            size="sm"
            className="self-start px-1"
            onClick={() => {
              setDraft(null);
              setStep(0);
            }}
          >
            <ArrowLeft />
            Back
          </Button>
        ) : (
          back(1)
        )}
      </>
    );
  } else {
    const err = submit.error instanceof ApiError || submit.error instanceof Error ? submit.error.message : null;
    body = (
      <>
        {head}
        <div className="flex flex-col gap-2">
          <p className="text-small font-semibold">
            Payment receipt <span className="font-medium text-fg-muted">(required)</span>
          </p>
          {file ? (
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <span className="grid h-12 w-10 place-items-center rounded-sm bg-brand-soft text-micro font-extrabold text-brand-ink">{file.type === "application/pdf" ? "PDF" : "IMG"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-small font-semibold">{file.name}</span>
                <span className="text-caption text-fg-muted">{Math.max(1, Math.round(file.size / 1024))} KB</span>
              </span>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove receipt" onClick={() => setFile(null)} disabled={submit.isPending}>
                <X />
              </Button>
            </div>
          ) : (
            <label
              className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-dropzone-line bg-dropzone px-3 py-5 text-center transition-colors hover:border-brand focus-within:border-brand"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                pickFile(e.dataTransfer.files[0]);
              }}
            >
              <Upload className="h-6 w-6" aria-hidden />
              <span className="text-small font-semibold">Upload receipt</span>
              <span className="text-caption text-fg-muted">PNG, JPG or PDF · max 5 MB</span>
              <input type="file" className="sr-only" accept="application/pdf,image/png,image/jpeg" onChange={(e) => pickFile(e.target.files?.[0])} />
            </label>
          )}
          {fileError && (
            <p className="text-caption text-danger-helper" role="alert">
              {fileError}
            </p>
          )}
        </div>
        {submit.isPending && (
          <div className="flex flex-col items-center gap-1 py-1 text-center" role="status">
            <Illustration name="payout-processing" className="h-20 w-auto" />
            <span className="text-small text-muted-foreground">Uploading the receipt and recording the payout…</span>
          </div>
        )}
        <dl className="grid grid-cols-2 gap-y-1 text-small">
          <dt className="text-muted-foreground">Paid on</dt>
          <dd className="text-right font-semibold">{new Date(`${paidOn}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</dd>
          <dt className="text-muted-foreground">UTR</dt>
          <dd className="truncate text-right font-semibold">{utr || "—"}</dd>
        </dl>
        {summary}
        {err && (
          <p className="text-small text-danger-helper" role="alert">
            {submit.error instanceof OutcomeUnknownError ? err : draft ? `${err} The draft still needs its receipt.` : `${err} Nothing was paid; your posts are still in Dues.`}
          </p>
        )}
        <Button variant="success" size="lg" className="w-full" disabled={!file || submit.isPending} onClick={() => submit.mutate()}>
          <CircleCheck />
          {submit.isPending ? "Submitting payout…" : "Submit payout"}
        </Button>
        {back(2)}
      </>
    );
  }

  return (
    <div className={cn("flex flex-col gap-5 rounded-modal bg-peach px-3 pb-3 pt-6", className)}>
      <VerticalSteps steps={STEPS} current={draft && !done ? Math.max(step, 2) : step} allDone={!!done} />
      {drafts.length > 0 && !draft && !done && (
        <Card className="flex flex-col gap-2 border-warning/40 p-4 text-small">
          <p className="flex items-center gap-2 font-semibold text-warning-fg">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {drafts.length === 1 ? "A payout is waiting for its receipt" : `${drafts.length} payouts are waiting for receipts`}
          </p>
          {drafts.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2">
              <span>
                <Money value={d.netAmount} className="font-semibold" /> · {d.items?.length ?? 0} posts
              </span>
              <span className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraft(d);
                    setStep(2);
                  }}
                >
                  Add receipt
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(d)}>
                  Cancel draft…
                </Button>
              </span>
            </div>
          ))}
          <p className="text-caption text-muted-foreground">Its posts stay out of Dues until it&apos;s finished or cancelled.</p>
        </Card>
      )}
      <Card ref={cardRef} tabIndex={-1} className="flex flex-col gap-4 p-4 outline-none">
        {body}
      </Card>

      <Dialog open={!!confirmCancel} onOpenChange={(o) => !o && setConfirmCancel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this draft payout?</DialogTitle>
            <DialogDescription>
              Nothing has been paid on it. Cancelling puts its {confirmCancel?.items?.length ?? 0} posts back in Dues so you can pay them again.
            </DialogDescription>
          </DialogHeader>
          {cancelDraft.isError && <p className="text-caption text-danger-helper">Couldn&apos;t cancel it. Try again.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancel(null)}>
              Keep draft
            </Button>
            <Button variant="destructive" disabled={cancelDraft.isPending} onClick={() => confirmCancel && cancelDraft.mutate(confirmCancel)}>
              {cancelDraft.isPending ? "Cancelling…" : "Cancel draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

/** Segmented single choice (radio group) in the reference's bordered-button style. */
function Choice({ options, value, onChange, name, disabled }: { options: { label: string; value: string }[]; value: string; onChange: (v: string) => void; name: string; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-control-sm rounded-md border text-small font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring-soft disabled:opacity-50",
            value === o.value ? "border-brand bg-brand-50 text-brand-ink" : "border-input bg-card text-fg-strong hover:bg-muted"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
