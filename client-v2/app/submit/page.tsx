"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, canUse, links as linksApi, type Campaign } from "@/lib/api-client";
import { isEnded } from "@/lib/campaigns";
import { plural } from "@/lib/format";
import { BOOKABLE_FORMATS, type BookableFormat } from "@/lib/formats";
import { formatName } from "@/lib/plans";
import { useCampaigns } from "@/lib/queries/campaigns";
import { invalidateCreator, uploadProof, useMyPages } from "@/lib/queries/creator";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, Illustration } from "@/components/taggify/illustration";
import { PlatformIcon } from "@/components/taggify/platform-icon";
import { SegmentedFilter } from "@/components/taggify/segmented-filter";
import { displayHandle, PageAvatar } from "@/components/finance/identity";
import { LoadError, NoAccess } from "@/components/finance/states";
import { ProofPicker } from "@/components/creator/proof-upload";
import { BulkLinks } from "@/components/creator/bulk-links";

const STEPS = ["Campaign", "Page", "Link & proof"];

export default function SubmitPage() {
  return (
    <AppShell active="submit">
      <Suspense>
        <Submit />
      </Suspense>
    </AppShell>
  );
}

/** A campaign row the caller can post to: their pages booked on it, with what's left per page. */
function slotsLeft(c: Campaign, assetId: string) {
  const q = c.pageQuota?.find((x) => x.assetId === assetId);
  return q ? Math.max(0, q.booked - q.submitted) : 0;
}

function Submit() {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const campaigns = useCampaigns();
  const pages = useMyPages();
  // ?campaign=<id> (a campaign's "Upload links") starts on that campaign; &mode=bulk opens the paste box.
  const params = useSearchParams();
  const linkedCampaign = params.get("campaign");
  const [mode, setMode] = useState<"one" | "bulk">(params.get("mode") === "bulk" ? "bulk" : "one");
  const [step, setStep] = useState(linkedCampaign ? 1 : 0);
  const [campaignId, setCampaignId] = useState<string | null>(linkedCampaign);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<BookableFormat>("reel");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<{ proofFailed: boolean } | null>(null);

  const open = useMemo(() => (campaigns.data ?? []).filter((c) => !isEnded(c) && (c.bookedAssetIds?.length ?? 0) > 0), [campaigns.data]);
  const campaign = open.find((c) => c.id === campaignId) ?? null;
  const bookedPages = (pages.data ?? []).filter((p) => campaign?.bookedAssetIds?.includes(p.id));
  const page = bookedPages.find((p) => p.id === assetId) ?? null;
  // Prefer a format this page has a rate for (a Reel + Story combo is posted as its reel and its story).
  useEffect(() => {
    const priced = page?.rateCards.map((r) => r.format) ?? [];
    if (page && !priced.includes(format)) setFormat(BOOKABLE_FORMATS.find((f) => priced.includes(f)) ?? "reel");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id]);
  const urlOk = /^https?:\/\/(www\.)?(instagram\.com|youtube\.com|youtu\.be)\/\S+$/i.test(url.trim());

  const submit = useMutation({
    mutationFn: async () => {
      const post = await linksApi.create(accessToken!, { campaignId: campaignId!, assetId: assetId!, url: url.trim(), format });
      try {
        await uploadProof(accessToken!, post.id, file!);
        return { proofFailed: false };
      } catch {
        // The post is saved; only the screenshot is missing. Home lists it under "Fix these".
        return { proofFailed: true };
      }
    },
    onSuccess: async (r) => {
      setResult(r);
      await invalidateCreator(qc);
    },
  });

  // Picking a page needs the pages list too.
  if (!canUse(user, "links.edit") || !canUse(user, "inventory.view") || (user?.role !== "CREATOR" && user?.role !== "TEAM_MEMBER")) return <NoAccess what="submitting posts" />;

  if (result) {
    return (
      <Card className="mx-auto mt-6 flex max-w-lg flex-col items-center gap-3 p-8 text-center">
        <Illustration name={result.proofFailed ? "error-state" : "creator-01"} className="h-36 w-auto" />
        <h1 className="text-section">{result.proofFailed ? "Post saved, but the proof didn't upload" : "Post submitted"}</h1>
        <p className="text-body text-muted-foreground">{result.proofFailed ? "Add the screenshot from Home under “Fix these” so it can be reviewed." : "It's waiting for review. You'll see it move to Verified on your campaign."}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to Home</Link>
          </Button>
          <Button
            onClick={() => {
              setResult(null);
              setStep(1);
              setAssetId(null);
              setUrl("");
              setFile(null);
              submit.reset();
            }}
          >
            Submit another
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 pt-2">
      <div>
        <h1 className="text-display">Submit a post</h1>
        <p className="mt-1 text-body text-muted-foreground">{mode === "one" ? "Pick the campaign and page, paste the link, and add the screenshot." : "Paste several post links at once. Add each screenshot afterwards from Home."}</p>
      </div>

      <SegmentedFilter
        label="How to submit"
        value={mode}
        onChange={setMode}
        options={[
          { value: "one", label: "One post" },
          { value: "bulk", label: "Paste several links" },
        ]}
        className="self-start"
      />

      {mode === "bulk" &&
        (campaigns.isError || pages.isError ? (
          <Card>
            <LoadError onRetry={() => (campaigns.isError ? campaigns.refetch() : pages.refetch())} what={campaigns.isError ? "your campaigns" : "your pages"} />
          </Card>
        ) : campaigns.isLoading || pages.isLoading ? (
          <Skeleton className="h-64 rounded-card" />
        ) : open.length === 0 ? (
          <Card>
            <EmptyState name="empty-campaigns" title="Nothing to post right now">
              When a brand books one of your pages, its campaign shows up here.
            </EmptyState>
          </Card>
        ) : (
          <BulkLinks campaigns={open} pages={pages.data ?? []} initialCampaignId={campaignId} />
        ))}

      {mode === "one" && (
        <>
        <ol className="flex flex-wrap gap-2" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? "step" : undefined} className={cn("flex items-center gap-2 rounded-pill border bg-card py-1 pl-1 pr-3 text-small font-medium text-fg-muted", i === step && "border-brand-200 text-brand-ink", i < step && "text-foreground")}>
              <span className={cn("grid h-6 w-6 place-items-center rounded-full bg-muted text-micro font-bold", i === step && "bg-brand text-brand-foreground", i < step && "bg-step-done text-brand-ink")}>{i < step ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="flex flex-col gap-3">
            {campaigns.isError ? (
              <Card>
                <LoadError onRetry={() => campaigns.refetch()} what="your campaigns" />
              </Card>
            ) : campaigns.isLoading ? (
              <Skeleton className="h-32 rounded-card" />
            ) : open.length === 0 ? (
              <Card>
                <EmptyState name="empty-campaigns" title="Nothing to post right now">
                  When a brand books one of your pages, its campaign shows up here.
                </EmptyState>
              </Card>
            ) : (
              open.map((c) => {
                const left = (c.bookedAssetIds ?? []).reduce((s, id) => s + slotsLeft(c, id), 0);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCampaignId(c.id);
                      setAssetId(null);
                      setStep(1);
                    }}
                    className="flex items-center gap-4 rounded-card border bg-card p-4 text-left shadow-2 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring-soft"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-strong">{c.title}</span>
                      <span className="block text-small text-fg-muted">
                        {c.brandName} · {left ? `${plural(left, "post")} to go` : "All booked posts are up"}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-fg-muted" aria-hidden />
                  </button>
                );
              })
            )}
          </div>
        )}

        {step > 0 && !campaign && !campaigns.isLoading && (
          // The campaign left the list (ended, or a refetch dropped it): start over.
          <Card className="flex flex-col items-start gap-3 p-5">
            <p className="text-body">That campaign isn&apos;t open for posts any more.</p>
            <Button variant="outline" onClick={() => setStep(0)}>
              <ArrowLeft />
              Pick another campaign
            </Button>
          </Card>
        )}

        {step === 1 && campaign && (
          <div className="flex flex-col gap-3">
            <p className="text-body-strong">{campaign.title}</p>
            <p className="-mt-2 text-small text-muted-foreground">Pick the page you posted from. Only pages booked on this campaign show.</p>
            {pages.isError ? (
              <Card>
                <LoadError onRetry={() => pages.refetch()} what="your pages" />
              </Card>
            ) : pages.isLoading ? (
              <Skeleton className="h-20 rounded-card" />
            ) : bookedPages.length === 0 ? (
              <Card>
                <EmptyState name="empty-search" title="No booked page found">
                  None of the pages you can see are booked on this campaign. Ask your Taggify contact to check the booking.
                </EmptyState>
              </Card>
            ) : null}
            {bookedPages.map((p) => {
              const left = slotsLeft(campaign, p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setAssetId(p.id);
                    setStep(2);
                  }}
                  className="flex items-center gap-3 rounded-card border bg-card p-4 text-left shadow-2 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring-soft"
                >
                  <PageAvatar assetId={p.id} handle={p.handle} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-body-strong">
                      <PlatformIcon platform={p.platform} size={16} />
                      {displayHandle(p.handle, p.platform)}
                    </span>
                    <span className="text-small text-fg-muted">{left ? `${plural(left, "post")} left on this booking` : "Booking already filled · an extra post won't be paid"}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-fg-muted" aria-hidden />
                </button>
              );
            })}
            <Button variant="ghost" className="self-start" onClick={() => setStep(0)}>
              <ArrowLeft />
              Back
            </Button>
          </div>
        )}

        {step === 2 && campaign && !page && !pages.isLoading && (
          <Card className="flex flex-col items-start gap-3 p-5">
            <p className="text-body">That page isn&apos;t booked on this campaign any more.</p>
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft />
              Pick another page
            </Button>
          </Card>
        )}

        {step === 2 && campaign && page && (
          <Card className="flex flex-col gap-5 p-5 md:p-6">
            <div className="flex items-center gap-3">
              <PageAvatar assetId={page.id} handle={page.handle} size="sm" />
              <span className="text-body">
                <span className="font-semibold">{displayHandle(page.handle, page.platform)}</span> · {campaign.title}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Content type</Label>
              <SegmentedFilter label="Content type" value={format} onChange={(v) => setFormat(v)} options={BOOKABLE_FORMATS.map((f) => ({ value: f, label: `${formatName(f)}${!(page.rateCards ?? []).some((r) => r.format === f) ? " (no rate set)" : ""}` }))} className="self-start" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="post-url">Post link</Label>
              <Input id="post-url" inputMode="url" placeholder="https://www.instagram.com/reel/…" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={url && !urlOk ? true : undefined} />
              {url && !urlOk && <p className="text-small text-danger-helper">Paste the full Instagram or YouTube link to the post.</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label>Proof screenshot</Label>
              <ProofPicker file={file} onFile={setFile} error={fileError} onError={setFileError} />
            </div>
            {submit.isError && (
              <p className="text-small text-danger-helper" role="alert">
                {submit.error instanceof ApiError || submit.error instanceof Error ? submit.error.message : "Couldn't submit the post. Try again."}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft />
                Back
              </Button>
              <Button size="lg" className="ml-auto" disabled={!urlOk || !file || submit.isPending} onClick={() => submit.mutate()}>
                {submit.isPending ? "Submitting…" : "Submit post"}
              </Button>
            </div>
          </Card>
        )}
        </>
      )}
    </div>
  );
}
