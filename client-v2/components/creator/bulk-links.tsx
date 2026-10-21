"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth-context";
import { ApiError, links as linksApi, type Asset, type Campaign } from "@/lib/api-client";
import { plural } from "@/lib/format";
import { BOOKABLE_FORMATS, isBookableFormat, type BookableFormat } from "@/lib/formats";
import { formatName } from "@/lib/plans";
import { invalidateCreator } from "@/lib/queries/creator";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { inputClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedFilter } from "@/components/taggify/segmented-filter";
import { displayHandle } from "@/components/finance/identity";

type Format = BookableFormat;

/**
 * v1 "Upload links": many post URLs for one campaign, page and format in one
 * request. No screenshot here; each new post shows on Home under "Fix these"
 * until its proof is added. The server skips repeat or unusable posts, but one
 * line that isn't a web address (or more than MAX_LINKS) fails the whole
 * request (links/schemas.js), so those are caught here first.
 */
const MAX_LINKS = 200;
const isWebUrl = (u: string) => {
  try {
    return /^https?:$/.test(new URL(u).protocol);
  } catch {
    return false;
  }
};

export function BulkLinks({ campaigns, pages, initialCampaignId }: { campaigns: Campaign[]; pages: Asset[]; initialCampaignId?: string | null }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const [campaignId, setCampaignId] = useState(initialCampaignId ?? campaigns[0]?.id ?? "");
  const [assetId, setAssetId] = useState("");
  const [format, setFormat] = useState<Format>("reel");
  const [text, setText] = useState("");

  const campaign = campaigns.find((c) => c.id === campaignId);
  const pageOptions = pages.filter((p) => campaign?.bookedAssetIds?.includes(p.id));
  const page = pageOptions.find((p) => p.id === assetId);
  const urls = text
    .split("\n")
    .map((u) => u.trim())
    .filter(Boolean);
  const badUrls = urls.filter((u) => !isWebUrl(u));
  const tooMany = urls.length > MAX_LINKS;
  const quota =campaign?.pageQuota?.find((q) => q.assetId === assetId);

  // The lists can arrive after this mounts: keep the campaign and page choices valid.
  const campaignIds = campaigns.map((c) => c.id).join(",");
  useEffect(() => {
    if (!campaigns.some((c) => c.id === campaignId)) setCampaignId(campaigns[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignIds]);
  const pageIds = pageOptions.map((p) => p.id).join(",");
  useEffect(() => {
    if (!pageOptions.some((p) => p.id === assetId)) setAssetId(pageOptions[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, pageIds]);
  // Prefer a format this page has a rate for.
  useEffect(() => {
    const priced = page?.rateCards.map((r) => r.format) ?? [];
    if (!priced.includes(format)) setFormat(BOOKABLE_FORMATS.find((f) => priced.includes(f)) ?? priced.find(isBookableFormat) ?? "reel");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  const submit = useMutation({
    mutationFn: () => linksApi.bulkCreate(accessToken!, { campaignId, assetId, format, urls }),
    onSuccess: () => invalidateCreator(qc),
  });
  const result = submit.data;

  if (result) {
    return (
      <Card className="flex flex-col gap-4 p-5 md:p-6" data-testid="bulk-result">
        <div>
          <h2 className="text-section">{plural(result.created.length, "link")} submitted</h2>
          {result.created.length > 0 && <p className="mt-1 text-body text-muted-foreground">Add each post&apos;s screenshot from Home under &ldquo;Fix these&rdquo; so it can be reviewed.</p>}
        </div>
        {result.skipped.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-body-strong text-danger-helper">{result.skipped.length} skipped</p>
            <ul className="flex flex-col divide-y rounded-card border">
              {result.skipped.map((s, i) => (
                <li key={`${s.url}-${i}`} className="px-3 py-2">
                  <span className="block truncate text-small font-medium">{s.url}</span>
                  <span className="block text-small text-fg-muted">{s.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to Home</Link>
          </Button>
          <Button
            onClick={() => {
              setText("");
              submit.reset();
            }}
          >
            Paste more links
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-5 p-5 md:p-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="bulk-campaign">Campaign</Label>
        <Select value={campaignId} onValueChange={setCampaignId}>
          <SelectTrigger id="bulk-campaign">
            <SelectValue placeholder="Pick a campaign" />
          </SelectTrigger>
          <SelectContent>
            {campaigns.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="bulk-page">Page</Label>
        {pageOptions.length === 0 ? (
          <p className="rounded-md bg-muted px-3 py-2 text-small text-muted-foreground" data-testid="bulk-not-booked">
            None of your pages is booked on this campaign. Ask your Taggify contact to check the booking.
          </p>
        ) : (
          <Select value={assetId} onValueChange={setAssetId}>
            <SelectTrigger id="bulk-page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {displayHandle(p.handle, p.platform)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {quota && (
          <p data-testid="bulk-quota" className={cn("text-small", quota.submitted > quota.booked ? "text-danger-helper" : "text-fg-muted")}>
            {quota.submitted > quota.booked
              ? `${quota.submitted} posted, but only ${quota.booked} booked. The extra ${quota.submitted - quota.booked} won't be paid.`
              : `${quota.submitted} of ${quota.booked} booked posts up${quota.booked - quota.submitted > 0 ? ` · ${plural(quota.booked - quota.submitted, "post")} to go` : " · that's all of them"}. Extra posts still submit, but only the booked number is paid.`}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Content type</Label>
        <SegmentedFilter
          label="Content type"
          value={format}
          onChange={setFormat}
          options={BOOKABLE_FORMATS.map((f) => ({ value: f, label: `${formatName(f)}${page && !page.rateCards.some((r) => r.format === f) ? " (no rate set)" : ""}` }))}
          className="self-start"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="bulk-urls">Post links{urls.length > 0 ? ` · ${urls.length}` : ""}</Label>
        <textarea id="bulk-urls" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"https://www.instagram.com/reel/…\nhttps://www.instagram.com/reel/…"} className={cn(inputClass, "min-h-32 resize-y py-2 font-mono")} />
        <p className="text-small text-fg-muted">One link per line, up to {MAX_LINKS}. You&apos;ll add each screenshot afterwards from Home.</p>
        {badUrls.length > 0 && (
          <div className="text-small text-danger-helper" role="alert">
            <p>{badUrls.length === 1 ? "This line isn't a link. Fix or remove it:" : `These ${badUrls.length} lines aren't links. Fix or remove them:`}</p>
            <ul className="mt-1 list-disc pl-5">
              {badUrls.slice(0, 5).map((u, i) => (
                <li key={i} className="break-all font-mono">
                  {u}
                </li>
              ))}
              {badUrls.length > 5 && <li>and {badUrls.length - 5} more</li>}
            </ul>
          </div>
        )}
        {tooMany && (
          <p className="text-small text-danger-helper" role="alert">
            That&apos;s {urls.length} links. Submit at most {MAX_LINKS} at a time.
          </p>
        )}
      </div>

      {submit.isError && (
        <p className="text-small text-danger-helper" role="alert">
          {submit.error instanceof ApiError || submit.error instanceof Error ? submit.error.message : "Couldn't submit these links. Try again."}
        </p>
      )}

      <Button size="lg" className="self-end" disabled={!campaignId || !assetId || urls.length === 0 || badUrls.length > 0 || tooMany || submit.isPending} onClick={() => submit.mutate()}>
        {submit.isPending ? "Submitting…" : urls.length > 1 ? `Submit ${urls.length} links` : "Submit link"}
      </Button>
    </Card>
  );
}
