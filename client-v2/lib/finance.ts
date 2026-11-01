/**
 * Finance helpers shared by the Creator Payouts list and the vendor payout
 * screen. Pure functions only (no React) so they can be reasoned about and
 * reused; the API calls themselves stay in lib/api-client.ts.
 */
import { links as linksApi, payments as paymentsApi, type Asset, type Link, type PageOwner, type PaymentInvoice, type PendingLink } from "@/lib/api-client";
import { formatLabel as sharedFormatLabel } from "@/lib/formats";

// ── Months ──────────────────────────────────────────────────────────

export type MonthKey = string; // "2026-10"

export function monthKeyOf(date: Date): MonthKey {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Local-time month bounds as ISO instants — what the payments API's from/to expect. */
export function monthRange(key: MonthKey): { from: string; to: string } {
  const [y, m] = key.split("-").map(Number);
  return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 0, 23, 59, 59, 999).toISOString() };
}

export function monthLabel(key: MonthKey, style: "short" | "long" = "short") {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: style, year: "numeric" });
}

/** The current month and the previous `count - 1`, newest first. */
export function recentMonths(count = 6, now = new Date()): MonthKey[] {
  return Array.from({ length: count }, (_, i) => monthKeyOf(new Date(now.getFullYear(), now.getMonth() - i, 1)));
}

export function inMonth(iso: string | null | undefined, key: MonthKey) {
  return !!iso && monthKeyOf(new Date(iso)) === key;
}

// ── Money (mirrors server/src/modules/payments/service.js computePayoutTotals) ──

export const GST_RATE = 0.18;
export const TDS_RATES = [1, 2, 10] as const;
export type TdsRate = (typeof TDS_RATES)[number] | null;

const paise = (n: number) => Math.round(n * 100) / 100;

/** Adds rupee amounts (API decimals come as strings) in whole paise, so long lists don't drift. */
export function sumMoney<T>(items: T[], amount: (item: T) => string | number | null | undefined) {
  return items.reduce((sum, item) => sum + Math.round(Number(amount(item) ?? 0) * 100), 0) / 100;
}

/**
 * Live preview of what the server will store. Unbilled links take the GST
 * toggle; raised invoices bring their own subtotal + GST. TDS is withheld from
 * the pre-GST subtotal. Rounded to paise at each step, like the server.
 */
export function computePayoutTotals(costs: number[], isGst: boolean, tds: TdsRate, invoices: Pick<PaymentInvoice, "subtotal" | "gstAmount">[] = []) {
  const linksSubtotal = paise(costs.reduce((sum, c) => sum + c, 0));
  const subtotal = paise(linksSubtotal + invoices.reduce((sum, inv) => sum + Number(inv.subtotal), 0));
  const gstAmount = paise((isGst ? linksSubtotal * GST_RATE : 0) + invoices.reduce((sum, inv) => sum + Number(inv.gstAmount), 0));
  const tdsAmount = tds ? paise(subtotal * (tds / 100)) : 0;
  return { subtotal, gstAmount, tdsAmount, netAmount: paise(subtotal + gstAmount - tdsAmount) };
}

// ── Dues ────────────────────────────────────────────────────────────

/** Every payable status shows as either Verified (insights approved) or Pending (proof/insights still to come — still payable). */
export function dueStatus(status: Link["status"]): { label: "Verified" | "Pending"; tone: "success" | "warning"; detail: string } {
  if (status === "INSIGHTS_APPROVED") return { label: "Verified", tone: "success", detail: "Insights approved" };
  const detail: Partial<Record<Link["status"], string>> = {
    SUBMITTED: "Posted — proof not reviewed yet",
    PENDING_SCREENSHOT_REVIEW: "Proof waiting for review",
    SCREENSHOT_APPROVED: "Proof approved — insights not in yet",
    INSIGHTS_PENDING: "Insights waiting for review",
  };
  return { label: "Pending", tone: "warning", detail: `${detail[status] ?? "Not verified yet"}. Still payable.` };
}

/** When the work happened: posted date, or when it was submitted if the scrape hasn't reported one. */
export function workDate(link: Pick<Link, "postedAt" | "createdAt">) {
  return link.postedAt ?? link.createdAt;
}

export function latestSnapshot(link: Pick<Link, "postSnapshots">) {
  return link.postSnapshots?.[0] ?? null;
}

/** The <img> src for a post's cover — our proxied copy (see links.thumbnailUrl), or null until a scrape has found one. */
export function postThumbSrc(link: Pick<Link, "id" | "postSnapshots">) {
  return latestSnapshot(link)?.thumbnailUrl ? linksApi.thumbnailUrl(link.id) : null;
}

/** First line of the caption, trimmed — the post's title in lists. */
export function captionTitle(caption: string | null | undefined) {
  const line = caption?.split("\n").find((l) => l.trim())?.trim();
  if (!line) return null;
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

export function formatLabel(format: string | null | undefined) {
  return sharedFormatLabel(format) || "Post";
}

// ── Vendors ─────────────────────────────────────────────────────────

export type VendorStatus = "due" | "partial" | "paid";

export type VendorRow = {
  id: string;
  owner: PageOwner;
  links: PendingLink[];
  invoices: PaymentInvoice[];
  pages: Asset[];
  totalDue: number;
  dueThisMonth: number;
  paidThisMonth: number;
  campaigns: number;
  status: VendorStatus;
};

/**
 * Groups the Pending list by vendor (page owner) and folds in each vendor's
 * pages and what they were paid this month. Status is derived for the month,
 * not stored: nothing owed → Paid; something paid this month and something
 * still owed → Partially paid; otherwise Due.
 */
export function buildVendorRows(input: {
  links: PendingLink[];
  invoices: PaymentInvoice[];
  assets: Asset[];
  paidThisMonth: Map<string, { amount: number; owner: PageOwner | null }>;
  month: MonthKey;
}): VendorRow[] {
  const rows = new Map<string, VendorRow>();
  const ensure = (id: string, owner: PageOwner | null | undefined) => {
    let row = rows.get(id);
    if (!row) {
      row = {
        id,
        owner: owner ?? { id, name: null, phoneNumber: null },
        links: [],
        invoices: [],
        pages: input.assets.filter((a) => a.ownerId === id),
        totalDue: 0,
        dueThisMonth: 0,
        paidThisMonth: 0,
        campaigns: 0,
        status: "due",
      };
      rows.set(id, row);
    }
    return row;
  };
  for (const link of input.links) {
    const row = ensure(link.asset.ownerId, link.asset.owner);
    row.links.push(link);
    row.totalDue += Number(link.cost);
    if (inMonth(workDate(link), input.month)) row.dueThisMonth += Number(link.cost);
  }
  for (const inv of input.invoices) {
    const row = ensure(inv.creatorId, inv.creator);
    row.invoices.push(inv);
    row.totalDue += Number(inv.amount);
    if (inMonth(inv.createdAt, input.month)) row.dueThisMonth += Number(inv.amount);
  }
  for (const [id, paid] of input.paidThisMonth) ensure(id, paid.owner).paidThisMonth = paid.amount;
  for (const row of rows.values()) {
    row.totalDue = paise(row.totalDue);
    row.dueThisMonth = paise(row.dueThisMonth);
    row.campaigns = new Set([...row.links.map((l) => l.campaignId), ...row.invoices.flatMap((i) => i.links.map((l) => l.campaign?.id ?? ""))].filter(Boolean)).size;
    row.status = row.totalDue === 0 ? "paid" : row.paidThisMonth > 0 ? "partial" : "due";
  }
  return [...rows.values()];
}

export const VENDOR_STATUS: Record<VendorStatus, { label: string; tone: "danger" | "warning" | "success" }> = {
  due: { label: "Due", tone: "danger" },
  partial: { label: "Partially paid", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
};

// ── Receipt upload ──────────────────────────────────────────────────

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

/** Null when the file is fine, otherwise what's wrong and how to fix it. */
export function receiptProblem(file: File): string | null {
  const ok = file.type === "application/pdf" || file.type === "image/png" || file.type === "image/jpeg";
  if (!ok) return `${file.name} isn't a PDF, PNG or JPG. Upload the payment receipt in one of those formats.`;
  if (file.size > RECEIPT_MAX_BYTES) return `${file.name} is over 5 MB. Upload a smaller copy of the receipt.`;
  return null;
}

/** Direct-to-Cloudinary signed upload, then confirm on the API — which is what marks the payout PAID. */
export async function uploadPayoutReceipt(token: string, payoutId: string, file: File, extra: { paidOn: string; utr: string }) {
  const params = await paymentsApi.requestReceiptUpload(token, payoutId);
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", params.apiKey);
  form.append("timestamp", String(params.timestamp));
  form.append("signature", params.signature);
  form.append("public_id", params.publicId);
  const res = await fetch(params.uploadUrl, { method: "POST", body: form });
  if (!res.ok) throw new Error("The receipt upload didn't go through. Check the file and try again.");
  // Local noon, not a bare date (the server would read a bare date as UTC midnight — the previous day west of UTC).
  const paidOn = extra.paidOn ? new Date(`${extra.paidOn}T12:00:00`).toISOString() : undefined;
  return paymentsApi.confirmReceipt(token, payoutId, params.publicId, file.name, { utr: extra.utr || undefined, paidOn });
}

export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
