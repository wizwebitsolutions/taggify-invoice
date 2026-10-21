"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Upload, Wallet } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { canUse, type Link as Post } from "@/lib/api-client";
import { POST_STATUS } from "@/lib/campaigns";
import { captionTitle, formatLabel, latestSnapshot } from "@/lib/finance";
import { personLabel, plural } from "@/lib/format";
import { useCampaigns } from "@/lib/queries/campaigns";
import { useMyPaid, useMyPending, useMyPosts } from "@/lib/queries/creator";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Illustration } from "@/components/taggify/illustration";
import { MetricTile } from "@/components/taggify/metric-tile";
import { Money } from "@/components/taggify/money";
import { ProgressBar } from "@/components/taggify/progress-meter";
import { StatusPill } from "@/components/taggify/status-pill";
import { ContentThumb, displayHandle } from "@/components/finance/identity";
import { FixProofDialog } from "./proof-upload";

/**
 * Creator / team-member Home, phone-first (spec §11–12). Order: submit a post,
 * fix rejected proofs, live campaigns with what's left to post, then money
 * (creators only — team members never see billing).
 */
export function CreatorHome() {
  const { user } = useAuth();
  const isCreator = user?.role === "CREATOR";
  const posts = useMyPosts();
  const campaigns = useCampaigns();
  const pending = useMyPending();
  const paid = useMyPaid();
  const [fixing, setFixing] = useState<Post | null>(null);
  const firstName = personLabel(user, "there").split(" ")[0];
  const canSubmit = canUse(user, "links.edit");

  const toFix = (posts.data ?? []).filter((p) => p.status === "SCREENSHOT_REJECTED" || (p.status === "SUBMITTED" && !p.screenshot));
  const live = (campaigns.data ?? []).filter((c) => (c.pageQuota ?? []).some((q) => q.booked > q.submitted));
  const readyAmount = (pending.data?.items ?? []).reduce((s, l) => s + Number(l.cost), 0);
  const lastPaid = paid.data?.items?.[0];

  return (
    <div className="flex flex-col gap-6 pt-2">
      <Card className="flex items-center gap-4 overflow-hidden p-5 md:p-6">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <p className="text-body text-muted-foreground">Hi {firstName}</p>
            <h1 className="text-display">{toFix.length ? plural(toFix.length, "thing") + " to fix" : live.length ? "Ready for your next post" : "You're all caught up"}</h1>
          </div>
          {canSubmit && (
            <Button asChild size="lg" className="self-start">
              <Link href="/submit">
                <Upload />
                Submit a post
              </Link>
            </Button>
          )}
        </div>
        <Illustration name="creator-01" className="hidden h-36 w-auto sm:block" />
      </Card>

      {toFix.length > 0 && (
        <section aria-labelledby="fix-title" className="flex flex-col gap-3">
          <h2 id="fix-title" className="text-section">
            Fix these
          </h2>
          <Card className="divide-y overflow-hidden border-danger/30">
            {toFix.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 p-4">
                <ContentThumb src={latestSnapshot(p)?.thumbnailUrl} format={p.format} />
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block truncate text-body-strong">{captionTitle(latestSnapshot(p)?.caption) ?? formatLabel(p.format)}</span>
                  <span className="block truncate text-small text-fg-muted">
                    {displayHandle(p.asset?.handle ?? "—", p.asset?.platform)} · {p.campaign?.title}
                  </span>
                </span>
                {/* Phone: status and action drop under the title so it keeps its width. */}
                <span className="flex w-full items-center gap-3 sm:w-auto">
                  <StatusPill tone={POST_STATUS[p.status].tone}>{POST_STATUS[p.status].label}</StatusPill>
                  {canSubmit && (
                    <Button size="sm" variant="outline" className="ml-auto" onClick={() => setFixing(p)}>
                      {p.status === "SCREENSHOT_REJECTED" ? "Upload new proof" : "Add proof"}
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}

      <section aria-labelledby="camp-title" className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 id="camp-title" className="text-section">
            Your campaigns
          </h2>
          <Link href="/campaigns" className="ml-auto text-small font-semibold text-brand-ink hover:underline">
            See all
          </Link>
        </div>
        {campaigns.isLoading ? (
          <Skeleton className="h-24 rounded-card" />
        ) : live.length === 0 ? (
          <Card className="p-6 text-center text-small text-muted-foreground">No posts are due right now. When a brand books one of your pages, it shows up here.</Card>
        ) : (
          <Card className="divide-y overflow-hidden">
            {live.slice(0, 5).map((c) => {
              const booked = (c.pageQuota ?? []).reduce((s, q) => s + q.booked, 0);
              const done = (c.pageQuota ?? []).reduce((s, q) => s + q.submitted, 0);
              return (
                <Link key={c.id} href={`/campaigns/${c.id}`} className="flex items-center gap-4 p-4 text-foreground hover:bg-accent hover:text-foreground">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-strong">{c.title}</span>
                    <span className="block text-small text-fg-muted">
                      {c.brandName} · {done} of {booked} posted
                    </span>
                  </span>
                  <span className="hidden w-32 sm:block" aria-hidden>
                    <ProgressBar value={done} max={booked} tone={booked && done >= booked ? "success" : "brand"} />
                  </span>
                  <ArrowRight className="h-4 w-4 text-fg-muted" aria-hidden />
                </Link>
              );
            })}
          </Card>
        )}
      </section>

      {isCreator && canUse(user, "finance.view") && (
        <section aria-labelledby="money-title" className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 id="money-title" className="text-section">
              Money
            </h2>
            <Link href="/money" className="ml-auto text-small font-semibold text-brand-ink hover:underline">
              Open Money
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <MetricTile tone="mint" icon={Wallet} label="Ready to invoice" loading={pending.isLoading} value={<Money value={readyAmount} />} meta={`${plural(pending.data?.items.length ?? 0, "post")} · or Taggify pays you directly`} />
            <MetricTile
              tone="coral"
              icon={Wallet}
              label="Last payment"
              loading={paid.isLoading}
              value={lastPaid ? <Money value={lastPaid.kind === "payout" ? lastPaid.payout.netAmount : lastPaid.invoice.amount} /> : "—"}
              meta={lastPaid?.paidAt ? `Paid ${new Date(lastPaid.paidAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : "Nothing paid yet"}
            />
          </div>
        </section>
      )}

      <FixProofDialog post={fixing} onClose={() => setFixing(null)} />
    </div>
  );
}
