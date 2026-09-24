"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/table-parts";
import { CheckCircleIcon, CloseIcon, UploadIcon } from "@/components/icons";
import { payments as paymentsApi, ApiError, type PageOwner, type Payout, type PendingLink } from "@/lib/api-client";
import { money, initialsOf } from "@/lib/format";
import { cn } from "@/lib/utils";

// Mirrors server/src/modules/payments/service.js's computePayoutTotals — the
// live preview has to match what the server actually adds/withholds.
const GST_RATE = 0.18;
const TDS_RATES = [1, 2, 10] as const;
type TdsRate = (typeof TDS_RATES)[number] | null;

const paise = (n: number) => Math.round(n * 100) / 100;

export function computeTotals(costs: number[], isGst: boolean, tds: TdsRate) {
  const subtotal = paise(costs.reduce((sum, c) => sum + c, 0));
  const gstAmount = isGst ? paise(subtotal * GST_RATE) : 0;
  const tdsAmount = tds ? paise(subtotal * (tds / 100)) : 0;
  return { subtotal, gstAmount, tdsAmount, netAmount: paise(subtotal + gstAmount - tdsAmount) };
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Direct-to-Cloudinary signed upload, then confirm — same two-step as every other attachment in the app. */
async function uploadReceipt(token: string, payoutId: string, file: File, extra: { paidOn: string; utr: string }) {
  const params = await paymentsApi.requestReceiptUpload(token, payoutId);
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", params.apiKey);
  form.append("timestamp", String(params.timestamp));
  form.append("signature", params.signature);
  form.append("public_id", params.publicId);
  const res = await fetch(params.uploadUrl, { method: "POST", body: form });
  if (!res.ok) throw new Error("The receipt upload was rejected — check the file and try again.");
  // Local noon, not a bare date (which the server reads as UTC midnight —
  // the previous day anywhere west of UTC).
  const paidOn = extra.paidOn ? new Date(`${extra.paidOn}T12:00:00`).toISOString() : undefined;
  return paymentsApi.confirmReceipt(token, payoutId, params.publicId, file.name, { ...extra, paidOn });
}

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback;
}

/**
 * "Pay vendor" — one screen instead of the old four-step wizard (24 Sep
 * redesign): the chosen links (removable), GST, TDS, the live net, paid-on
 * date, UTR, and the receipt. "Mark paid" creates the payout and attaches
 * the receipt in one go; if the upload fails the just-created draft is
 * cancelled so its links go straight back to Pending.
 *
 * `draft` mode finishes a payout that was created but never got a receipt
 * (the Pending tab's "waiting for a receipt" banner): its links and tax
 * split are already fixed server-side, so only the payment fields show.
 */
export function PaySheet(
  props: { token: string; onClose: () => void; onPaid: () => void } & (
    | { mode: "new"; vendor: PageOwner; links: PendingLink[]; onRemoveLink: (id: string) => void }
    | { mode: "draft"; payout: Payout }
  )
) {
  const { token, onClose, onPaid } = props;
  const [isGst, setIsGst] = useState(false);
  const [tds, setTds] = useState<TdsRate>(null);
  const [paidOn, setPaidOn] = useState(todayKey());
  const [utr, setUtr] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [paid, setPaid] = useState<Payout | null>(null);

  const vendorName = props.mode === "new" ? props.vendor.name ?? props.vendor.phoneNumber : props.payout.creator?.name ?? props.payout.creator?.phoneNumber ?? "vendor";
  const totals =
    props.mode === "new"
      ? computeTotals(props.links.map((l) => Number(l.cost)), isGst, tds)
      : {
          subtotal: Number(props.payout.subtotal),
          gstAmount: Number(props.payout.gstAmount),
          tdsAmount: Number(props.payout.tdsAmount),
          netAmount: Number(props.payout.netAmount),
        };
  const shownGst = props.mode === "new" ? isGst : props.payout.isGstInvoice;
  const shownTds = props.mode === "new" ? tds : props.payout.tdsPercent ? Number(props.payout.tdsPercent) : null;
  const linkCount = props.mode === "new" ? props.links.length : props.payout.items?.length ?? 0;

  const payMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Attach the payment receipt first.");
      if (props.mode === "draft") return uploadReceipt(token, props.payout.id, file, { paidOn, utr });
      const created = await paymentsApi.createPayout(token, {
        creatorId: props.vendor.id,
        linkIds: props.links.map((l) => l.id),
        isGstInvoice: isGst,
        tdsPercent: tds,
      });
      try {
        return await uploadReceipt(token, created.id, file, { paidOn, utr });
      } catch (err) {
        // Don't leave the links locked on a receipt-less draft — release them.
        await paymentsApi.cancelPayout(token, created.id).catch(() => undefined);
        throw err;
      }
    },
    onSuccess: (result) => setPaid(result),
  });

  function pickFile(next: File | undefined) {
    if (!next) return;
    const ok = next.type === "application/pdf" || next.type.startsWith("image/");
    // A rejected file never clears one that was already accepted.
    if (!ok) {
      setFileError(`${next.name} isn't a PDF or an image — ${file ? "kept the previous receipt" : "attach a PDF or an image of the payment receipt"}.`);
      return;
    }
    setFileError(null);
    setFile(next);
  }

  // #3 (review) — a file dropped anywhere outside the dropzone would make the
  // browser open it, losing the sheet. Swallow stray drops while it's open.
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  if (paid) {
    return (
      <Sheet onClose={onPaid} panelClassName="md:max-w-[420px]">
        <div className="flex flex-col items-center gap-4 p-8 pt-2 text-center" data-testid="payout-paid">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-accent-line bg-accent-soft text-accent">
            <CheckCircleIcon className="h-6 w-6" />
          </div>
          <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">Payout paid</h2>
          <p className="text-[0.8125rem] text-text-muted">
            {money(paid.netAmount)} to {vendorName}. {linkCount} link{linkCount === 1 ? "" : "s"} moved from Pending to Paid.
          </p>
          <Button className="w-full" onClick={onPaid}>
            Done
          </Button>
        </div>
      </Sheet>
    );
  }

  const canSubmit = !!file && linkCount > 0 && !!paidOn && !payMutation.isPending;

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[960px]">
      <div className="flex min-h-0 flex-1 flex-col" role="dialog" aria-label={`Pay ${vendorName}`} data-testid="pay-sheet">
        <div className="flex shrink-0 items-center gap-3 px-6 pb-4 pt-1">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[0.8125rem] font-semibold text-text-2 ring-1 ring-inset ring-border">
            {initialsOf(vendorName)}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[1.125rem] font-semibold tracking-[-0.02em]">
              {props.mode === "draft" ? "Finish payout to " : "Pay "}
              {vendorName}
            </h2>
            <p className="text-[0.8125rem] text-text-muted">
              {linkCount} link{linkCount === 1 ? "" : "s"}
              {props.mode === "draft" && " · GST/TDS already set on this draft"}
            </p>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto border-t border-border md:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col gap-5 p-6 md:border-r md:border-border">
            <StepTitle n={1} title="Links in this payout" hint={props.mode === "new" ? "Remove any you don't want to pay yet" : undefined} />
            {props.mode === "new" ? (
              <LinksByPage links={props.links} onRemove={props.onRemoveLink} />
            ) : (
              <DraftLinks payout={props.payout} />
            )}
            <p className="mt-auto text-[0.75rem] text-text-faint">Once marked paid, these links leave Pending for good and show under Paid — for you and for {vendorName}.</p>
          </div>

          <div className="flex flex-col gap-5 bg-surface-2 p-6">
            {props.mode === "new" && (
              <>
                <StepTitle n={2} title="GST & TDS" hint="Both work off the subtotal" />
                <div className="flex flex-col gap-2">
                  <p className="text-[0.72rem] font-medium uppercase tracking-[0.06em] text-text-faint">GST</p>
                  <label className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-border-strong bg-surface px-3.5 py-3">
                    <input type="checkbox" checked={isGst} onChange={(e) => setIsGst(e.target.checked)} className="h-4 w-4 accent-[var(--ink)]" />
                    <span className="flex flex-col">
                      <span className="text-[0.8375rem] font-semibold">Add 18% GST</span>
                      <span className="text-[0.75rem] text-text-muted">Vendor sent a GST invoice</span>
                    </span>
                  </label>
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-[0.72rem] font-medium uppercase tracking-[0.06em] text-text-faint">TDS withheld</p>
                  <div role="radiogroup" aria-label="TDS" className="grid grid-cols-4 rounded-[10px] border border-border-strong bg-surface p-[3px]">
                    {([null, ...TDS_RATES] as TdsRate[]).map((rate) => (
                      <button
                        key={String(rate)}
                        type="button"
                        role="radio"
                        aria-checked={tds === rate}
                        onClick={() => setTds(rate)}
                        className={cn("h-8 rounded-[7px] text-[0.8125rem] transition-colors", tds === rate ? "bg-ink font-medium text-ink-fg" : "text-text-2 hover:bg-surface-2")}
                      >
                        {rate ? `${rate}%` : "None"}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface p-4 text-[0.8125rem]" data-testid="payout-preview">
              <div className="flex justify-between text-text-2">
                <span>
                  Subtotal · {linkCount} link{linkCount === 1 ? "" : "s"}
                </span>
                <span className="tabular-nums">{money(totals.subtotal)}</span>
              </div>
              {shownGst && (
                <div className="flex justify-between text-text-2">
                  <span>GST 18%</span>
                  <span className="tabular-nums">+{money(totals.gstAmount)}</span>
                </div>
              )}
              {!!shownTds && (
                <div className="flex justify-between text-text-2">
                  <span>TDS {shownTds}% on subtotal</span>
                  <span className="tabular-nums">−{money(totals.tdsAmount)}</span>
                </div>
              )}
              <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2.5">
                <span className="font-semibold">Net payable</span>
                <span className="text-[1.25rem] font-semibold tabular-nums tracking-[-0.02em]">{money(totals.netAmount)}</span>
              </div>
            </div>

            <StepTitle n={props.mode === "new" ? 3 : 2} title="Payment & receipt" hint="Receipt is required" />
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-[0.78rem] font-medium text-text-2">
                Paid on
                <input
                  type="date"
                  value={paidOn}
                  max={todayKey()}
                  onChange={(e) => setPaidOn(e.target.value)}
                  className="h-9 rounded-md border border-border-strong bg-surface px-2.5 text-[0.8125rem] text-text shadow-card"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-[0.78rem] font-medium text-text-2">
                UTR / reference
                <input
                  value={utr}
                  onChange={(e) => setUtr(e.target.value)}
                  placeholder="Optional"
                  maxLength={60}
                  className="h-9 rounded-md border border-border-strong bg-surface px-2.5 text-[0.8125rem] text-text shadow-card placeholder:text-text-faint"
                />
              </label>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-[0.72rem] font-medium uppercase tracking-[0.06em] text-text-faint">Payment receipt</p>
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  pickFile(e.dataTransfer.files?.[0]);
                }}
                data-testid="receipt-dropzone"
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-[10px] border bg-surface px-3.5 py-3.5 transition-colors focus-within:ring-2 focus-within:ring-ink-30",
                  dragging ? "border-ink bg-surface-2" : file ? "border-accent-line" : "border-dashed border-border-strong hover:border-ink-30"
                )}
              >
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", file ? "bg-accent-soft text-accent" : "bg-surface-2 text-text-faint")}>
                  {file ? <CheckCircleIcon className="h-4 w-4" /> : <UploadIcon className="h-4 w-4" />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[0.8125rem] font-semibold">{file ? file.name : dragging ? "Drop to attach" : "Drop the receipt here, or click to browse"}</span>
                  <span className="text-[0.72rem] text-text-muted">{file ? `${Math.max(1, Math.round(file.size / 1024))} KB · click to replace` : "PDF or image · required to mark paid"}</span>
                </span>
                <input
                  type="file"
                  accept="application/pdf,.pdf,image/*"
                  aria-label="Payment receipt"
                  className="sr-only"
                  onChange={(e) => {
                    pickFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {fileError && <p className="text-[0.75rem] text-rose">{fileError}</p>}
            </div>

            {payMutation.isError && <ErrorNotice message={errorText(payMutation.error, "Couldn't complete this payout.")} />}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-border px-6 py-4">
          <Button variant="secondary" onClick={onClose} disabled={payMutation.isPending}>
            Cancel
          </Button>
          <span className="hidden flex-1 text-[0.75rem] text-text-faint sm:block">{file ? "" : "A receipt is required to mark paid."}</span>
          <Button className="ml-auto" onClick={() => payMutation.mutate()} disabled={!canSubmit}>
            {payMutation.isPending ? "Paying…" : `Mark paid · ${money(totals.netAmount)}`}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** A numbered step heading — the sheet reads top-to-bottom as 1 · links, 2 · tax, 3 · payment. */
function StepTitle({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[0.6875rem] font-semibold text-ink-fg">{n}</span>
      <span className="text-[0.875rem] font-semibold">{title}</span>
      {hint && <span className="ml-auto text-[0.72rem] text-text-faint">{hint}</span>}
    </div>
  );
}

function LinksByPage({ links, onRemove }: { links: PendingLink[]; onRemove: (id: string) => void }) {
  const pages = new Map<string, PendingLink[]>();
  for (const l of links) pages.set(l.asset.handle, [...(pages.get(l.asset.handle) ?? []), l]);
  if (links.length === 0) return <p className="text-[0.8125rem] text-text-muted">No links left on this payout — close and pick some from Pending.</p>;
  return (
    <div className="flex flex-col gap-5" data-testid="pay-sheet-links">
      {[...pages.entries()].map(([handle, pageLinks]) => (
        <div key={handle}>
          <div className="flex items-baseline justify-between border-b border-border pb-1.5">
            <span className="text-[0.8438rem] font-semibold">
              @{handle} <span className="font-normal text-text-muted">· {pageLinks.length} link{pageLinks.length === 1 ? "" : "s"}</span>
            </span>
            <span className="text-[0.8125rem] tabular-nums text-text-muted">{money(pageLinks.reduce((s, l) => s + Number(l.cost), 0))}</span>
          </div>
          {pageLinks.map((l) => (
            <div key={l.id} className="flex items-center gap-2.5 border-b border-border py-2 text-[0.8125rem]">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{l.campaign?.title ?? "—"}</span>
                <span className="text-[0.72rem] capitalize text-text-faint">
                  {l.format} · {l.postedAt ? `posted ${shortDate(l.postedAt)}` : `submitted ${shortDate(l.createdAt)}`}
                </span>
              </div>
              <span className="font-semibold tabular-nums">{money(l.cost)}</span>
              <button
                type="button"
                aria-label={`Remove ${l.campaign?.title ?? "link"} from this payout`}
                onClick={() => onRemove(l.id)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-text-faint hover:bg-surface-2 hover:text-text"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function DraftLinks({ payout }: { payout: Payout }) {
  return (
    <div className="flex flex-col">
      {(payout.items ?? []).map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-3 border-b border-border py-2 text-[0.8125rem]">
          <span className="min-w-0 truncate">
            <span className="font-medium">{item.link.campaign?.title ?? "—"}</span>
            <span className="capitalize text-text-faint">
              {" "}
              · @{item.link.asset?.handle ?? "—"} · {item.link.format}
            </span>
          </span>
          <span className="font-semibold tabular-nums">{money(item.amount)}</span>
        </div>
      ))}
    </div>
  );
}

export function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
