"use client";

import type { Asset } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/taggify/money";
import { displayHandle, PageAvatarStack } from "@/components/finance/identity";
import type { Basics } from "./basics-step";
import { type DraftItem, itemPostCount } from "./draft";
import { type Pricing, pricingTotals } from "./pricing-step";

/** Step 4 · Review. Everything is already saved; this is the last look before going to the plan. */
export function ReviewStep({
  basics,
  items,
  byId,
  budget,
  pricing,
}: {
  basics: Basics;
  items: DraftItem[];
  byId: Map<string, Asset>;
  budget: number | null;
  pricing: Pricing;
}) {
  const t = pricingTotals(items, byId, pricing);
  const pages = [...new Set(items.map((i) => i.assetId))].map((id) => byId.get(id)).filter((a): a is Asset => !!a);
  return (
    <div className="flex flex-col gap-6">
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="form-panel flex flex-col gap-5 p-6">
        <div>
          <p className="text-small text-muted-foreground">{basics.clientName}</p>
          <h2 className="text-h3">{basics.name}</h2>
        </div>
        <div>
          <p className="mb-1 text-small font-semibold text-muted-foreground">Brief</p>
          <p className="text-body">{basics.notes || "—"}</p>
        </div>
        <div>
          <p className="mb-2 text-small font-semibold text-muted-foreground">
            {pages.length} pages · {items.reduce((s, i) => s + itemPostCount(i), 0)} posts
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <PageAvatarStack pages={pages} max={8} />
            <span className="text-small text-muted-foreground">
              {pages
                .slice(0, 4)
                .map((a) => displayHandle(a.handle, a.platform))
                .join(", ")}
              {pages.length > 4 ? ` and ${pages.length - 4} more` : ""}
            </span>
          </div>
        </div>
      </Card>
      <Card className="summary-panel flex flex-col gap-4 p-6">
        <div>
          <p className="text-small font-semibold text-muted-foreground">Client pays</p>
          <p className="text-h2 font-bold">
            <Money value={t.total} />
          </p>
          <p className="text-small text-muted-foreground">{t.gst ? `Includes ${t.gst}% GST` : "No GST"}</p>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 border-t pt-3 text-small">
          <dt className="text-muted-foreground">Quoted</dt>
          <dd className="text-right font-medium">
            <Money value={t.quoted} />
          </dd>
          {t.discount > 0 && (
            <>
              <dt className="text-muted-foreground">Discount (before GST)</dt>
              <dd className="text-right font-medium text-success-fg">
                − <Money value={t.discount} />
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Our cost</dt>
          <dd className="text-right font-medium">
            <Money value={t.ourCost} />
          </dd>
          <dt className="text-muted-foreground">Internal budget</dt>
          <dd className="text-right font-medium">{budget ? <Money value={budget} /> : "Not set"}</dd>
          <dt className="text-muted-foreground">{t.margin >= 0 ? "Margin" : "Loss"}</dt>
          <dd className={cn("text-right font-semibold", t.margin >= 0 ? "text-success-fg" : "text-danger-fg")}>
            <Money value={Math.abs(t.margin)} />
          </dd>
        </dl>
      </Card>
    </div>
    {/* The sheet's layout is picked in the dialog "Client sheet" opens on the plan page (16 Oct), not here. */}
    </div>
  );
}
