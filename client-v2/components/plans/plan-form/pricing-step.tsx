"use client";

import { TriangleAlert } from "lucide-react";

import type { Asset } from "@/lib/api-client";
import { comboParts } from "@/lib/formats";
import { formatName } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money } from "@/components/taggify/money";
import { audienceLabel, displayHandle, PageAvatar } from "@/components/finance/identity";
import { BudgetMeter } from "./budget-meter";
import { comboSplitOf, type DraftItem, itemPostCount, itemPosts, lineCost } from "./draft";

/** `discount` (16 Oct): a flat rupee amount off the quoted total before GST; "" = none. */
export type Pricing = { overrideCost: string; overrideImpressions: string; gstPercent: string; discount: string };

export const gstValid = (g: string) => g.trim() === "" || (/^\d+$/.test(g.trim()) && Number(g) <= 100);
const quoteValid = (v: string) => v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) >= 0);
const impressionsValid = (v: string) => v.trim() === "" || /^\d+$/.test(v.trim());
const discountValid = (v: string) => v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) >= 0);
/** Every Pricing field in a shape the server accepts (blank = no override). */
export const pricingValid = (p: Pricing) => gstValid(p.gstPercent) && quoteValid(p.overrideCost) && impressionsValid(p.overrideImpressions) && discountValid(p.discount);

/** The numbers the Pricing step shows, also used by Review and the footer. */
export function pricingTotals(items: DraftItem[], byId: Map<string, Asset>, pricing: Pricing) {
  const ourCost = items.reduce((s, i) => s + lineCost(i, byId.get(i.assetId)), 0);
  const computedImpressions = items.reduce((s, i) => s + (byId.get(i.assetId)?.engagement?.avgViews ?? 0) * itemPostCount(i), 0);
  const quoted = pricing.overrideCost ? Number(pricing.overrideCost) : ourCost;
  const impressions = pricing.overrideImpressions ? Number(pricing.overrideImpressions) : computedImpressions;
  const gst = gstValid(pricing.gstPercent) && pricing.gstPercent.trim() ? Number(pricing.gstPercent) : 0;
  // Mirrors the server's annotatePlan: discount first (floored at 0), then GST on what's left, rounded to paise.
  const discount = discountValid(pricing.discount) && pricing.discount.trim() ? Number(pricing.discount) : 0;
  const taxable = Math.max(0, quoted - discount);
  const gstAmount = Math.round(taxable * gst) / 100;
  return { ourCost, computedImpressions, quoted, discount, taxable, impressions, gst, gstAmount, total: taxable + gstAmount, margin: taxable - ourCost, cpm: impressions > 0 ? (quoted / impressions) * 1000 : null };
}

/**
 * Step 3 · Pricing (v1 PriceStep). The client is quoted one overall total, not a
 * price per page: blank = the pages' cost. GST sits here, next to the total it
 * taxes. Expected impressions can be overridden the same way.
 */
export function PricingStep({ items, byId, budget, pricing, setPricing }: { items: DraftItem[]; byId: Map<string, Asset>; budget: number | null; pricing: Pricing; setPricing: (fn: (p: Pricing) => Pricing) => void }) {
  const t = pricingTotals(items, byId, pricing);
  const below = !!pricing.overrideCost && t.quoted < t.ourCost;
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="ledger-panel">
        <div className="flex items-center gap-3 px-5 pb-3 pt-5">
          <h2 className="text-card-title">Pages and expected reach</h2>
          <span className="ml-auto text-small text-muted-foreground">
            {new Set(items.map((i) => i.assetId)).size} pages · {items.reduce((s, i) => s + itemPostCount(i), 0)} posts
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Page</TableHead>
              <TableHead>Format</TableHead>
              <TableHead className="text-right">Followers</TableHead>
              <TableHead className="text-right">Expected views</TableHead>
              <TableHead className="text-right">Our cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => {
              const a = byId.get(i.assetId);
              // A Reel + Story combo is two posts, so it reaches twice (server annotatePlan).
              const views = (a?.engagement?.avgViews ?? 0) * itemPostCount(i);
              const split = comboSplitOf(i, a);
              const parts = comboParts(i.format);
              return (
                <TableRow key={`${i.assetId}:${i.format}`}>
                  <TableCell>
                    <span className="flex items-center gap-3">
                      <PageAvatar assetId={i.assetId} handle={a?.handle ?? "page"} size="sm" />
                      <span className="text-body-strong">{displayHandle(a?.handle ?? "—", a?.platform)}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {formatName(i.format)} × {itemPosts(i)}
                    {split && parts && (
                      <span className="block text-small text-muted-foreground">
                        {formatName(parts[0])} <Money value={split[parts[0]] ?? 0} /> + {formatName(parts[1])} <Money value={split[parts[1]] ?? 0} />
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{audienceLabel(a?.followers, a?.platform, true) ?? "—"}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{views ? audienceLabel(views, null, true) : "—"}</TableCell>
                  <TableCell className="text-right font-semibold">
                    <Money value={lineCost(i, a)} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="summary-panel flex flex-col gap-4 p-6">
          <h2 className="text-card-title">Client side</h2>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pl-quote">Total quoted to client (₹)</Label>
            <Input id="pl-quote" type="number" inputMode="numeric" min={0} className="h-control-lg text-h4" placeholder={String(Math.round(t.ourCost))} value={pricing.overrideCost} onChange={(e) => setPricing((p) => ({ ...p, overrideCost: e.target.value }))} />
            <p className="text-caption text-muted-foreground">
              Computed <Money value={t.ourCost} />. Leave blank to quote the pages&apos; cost.
            </p>
            {!quoteValid(pricing.overrideCost) && <p className="text-small text-danger-helper">Enter an amount of 0 or more, or leave it blank.</p>}
            {below && (
              <p className="flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-small text-warning-fg">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                This is below what the pages cost us.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pl-discount">
              Discount (₹) <span className="font-normal text-muted-foreground">(optional, before GST)</span>
            </Label>
            <Input id="pl-discount" type="number" inputMode="numeric" min={0} className="w-40" placeholder="0" value={pricing.discount} onChange={(e) => setPricing((p) => ({ ...p, discount: e.target.value }))} aria-invalid={!discountValid(pricing.discount)} />
            {!discountValid(pricing.discount) && <p className="text-small text-danger-helper">Enter an amount of 0 or more, or leave it blank.</p>}
            {t.discount > t.quoted && (
              <p className="flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-small text-warning-fg">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                The discount is more than the quoted total. The client would pay nothing.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pl-gst">GST (%)</Label>
            <Input id="pl-gst" type="number" inputMode="numeric" min={0} max={100} className="w-28" value={pricing.gstPercent} onChange={(e) => setPricing((p) => ({ ...p, gstPercent: e.target.value }))} aria-invalid={!gstValid(pricing.gstPercent)} />
            {!gstValid(pricing.gstPercent) && <p className="text-small text-danger-helper">Use a whole number from 0 to 100, or leave it blank for no GST.</p>}
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 border-t pt-3 text-small">
            <dt className="text-muted-foreground">Quoted</dt>
            <dd className="text-right font-medium">
              <Money value={t.quoted} />
            </dd>
            {t.discount > 0 && (
              <>
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="text-right font-medium text-success-fg">
                  − <Money value={t.discount} />
                </dd>
                <dt className="text-muted-foreground">After discount</dt>
                <dd className="text-right font-medium">
                  <Money value={t.taxable} />
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">GST{t.gst ? ` (${t.gst}%)` : ""}</dt>
            <dd className="text-right font-medium">{t.gst ? <Money value={t.gstAmount} signed /> : "None"}</dd>
            <dt className="text-body-strong">Client pays</dt>
            <dd className="text-right text-body-strong">
              <Money value={t.total} />
            </dd>
          </dl>
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-card-title">Internal</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-small">
            <dt className="text-muted-foreground">Budget</dt>
            <dd className="text-right font-medium">{budget ? <Money value={budget} /> : "Not set"}</dd>
            <dt className="text-muted-foreground">Our cost</dt>
            <dd className="text-right font-medium">
              <Money value={t.ourCost} />
            </dd>
            <dt className="text-muted-foreground">{t.margin >= 0 ? "Margin" : "Loss"}</dt>
            <dd className={cn("text-right font-semibold", t.margin >= 0 ? "text-success-fg" : "text-danger-fg")}>
              <Money value={Math.abs(t.margin)} />
              {t.quoted > 0 && <span className="ml-1 font-normal text-muted-foreground">({Math.round((t.margin / t.quoted) * 100)}%)</span>}
            </dd>
          </dl>
          <BudgetMeter budget={budget} used={t.ourCost} />
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-card-title">Expected reach</h2>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pl-impressions">Expected impressions</Label>
            <Input id="pl-impressions" type="number" inputMode="numeric" min={0} placeholder={String(t.computedImpressions)} value={pricing.overrideImpressions} onChange={(e) => setPricing((p) => ({ ...p, overrideImpressions: e.target.value }))} aria-invalid={!impressionsValid(pricing.overrideImpressions)} />
            {impressionsValid(pricing.overrideImpressions) ? (
              <p className="text-caption text-muted-foreground">Computed {t.computedImpressions.toLocaleString("en-IN")} from average views. Leave blank to use it.</p>
            ) : (
              <p className="text-small text-danger-helper">Use a whole number, or leave it blank.</p>
            )}
          </div>
          <p className="flex justify-between border-t pt-3 text-small">
            <span className="text-muted-foreground">Cost per 1,000 views</span>
            <span className="font-semibold">{t.cpm != null ? <Money value={Math.round(t.cpm)} /> : "—"}</span>
          </p>
        </Card>
      </div>
    </div>
  );
}
