"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, Select } from "@/components/ui/form-field";
import { ErrorNotice } from "@/components/ui/table-parts";
import { links as linksApi, ApiError, LINK_FORMATS } from "@/lib/api-client";
import { formatLabel, isBookableFormat } from "@/lib/formats";
import { cn } from "@/lib/utils";

// The bookable formats (14 Oct): Reel, Entertainment / Brand, PR, Political,
// Static & Carousel, Repost, Story, Political Story. A combo (Reel + Story,
// Repost + Story) is never posted as one link — its two posts go up separately. A page's rate card only needs *some* of these
// priced (unpriced ones say "(no rate set)"), but every page still sees the
// full set rather than only whichever formats already have a price.
const STANDARD_FORMATS: string[] = [...LINK_FORMATS];
/** The page's priced formats that can be posted as a link, in the app's order. */
const pricedBookable = (rateCards: { format: string }[] | undefined) => STANDARD_FORMATS.filter((f) => (rateCards ?? []).some((rc) => rc.format === f && isBookableFormat(rc.format)));

/**
 * Bulk link upload — paste any number of post URLs (one per line) and
 * submit them together in one request, matching creator.wldd.in's
 * "Upload Links" modal (a plain multi-line textarea + Submit, no toggle
 * between single/bulk since one URL is just the N=1 case of the same
 * flow). Shared by the Dashboard's global "Upload links" button and each
 * campaign card's own "Upload Links" action (which pins the campaign).
 */
export function UploadLinksModal({
  token,
  campaigns,
  assets,
  initialCampaignId,
  onClose,
  onCreated,
}: {
  token: string;
  campaigns: { id: string; title: string; bookedAssetIds?: string[]; pageQuota?: { assetId: string; booked: number; submitted: number }[] }[];
  assets: { id: string; handle: string; rateCards: { format: string }[] }[];
  initialCampaignId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  // Booked campaigns only (24 Sep): a creator can post only on a campaign
  // row one of their pages is booked on, and only for those pages.
  const bookable = campaigns.filter((c) => !c.bookedAssetIds || c.bookedAssetIds.length > 0);
  const [campaignId, setCampaignId] = useState(initialCampaignId ?? bookable[0]?.id ?? "");
  const selectedCampaign = campaigns.find((c) => c.id === campaignId);
  const pageOptions = !selectedCampaign ? [] : selectedCampaign.bookedAssetIds ? assets.filter((a) => selectedCampaign.bookedAssetIds!.includes(a.id)) : assets;
  const [assetId, setAssetId] = useState(pageOptions[0]?.id ?? "");
  const [urlsText, setUrlsText] = useState("");
  const [format, setFormat] = useState<string>(pricedBookable(assets[0]?.rateCards)[0] ?? STANDARD_FORMATS[0]);

  const asset = assets.find((a) => a.id === assetId);
  const urls = urlsText.split("\n").map((u) => u.trim()).filter(Boolean);

  // How many posts this page was booked for on this campaign, and how many
  // are already up (user report, 29 Sep — a creator had no way to know). Extra
  // posts beyond the booking still submit, but only the booked number counts.
  const quota = selectedCampaign?.pageQuota?.find((q) => q.assetId === assetId);
  const remaining = quota ? Math.max(0, quota.booked - quota.submitted) : null;

  // Bookable formats only — a legacy rate card with another format, or the
  // Reel + Story / Repost + Story combos, is not offered for new submissions.
  const availableFormats = STANDARD_FORMATS;

  // Keeps the page choice valid — on a campaign switch, and also when the
  // pages themselves arrive after the modal opened. The initial useState above
  // only runs once, so a creator who opened this before their pages loaded was
  // left with a <select> *showing* a page while the real choice stayed "" — no
  // quota line, and Submit would post with no page at all.
  // Same for the campaign: if the list arrives after opening, pick the first
  // bookable one rather than staying on "" (a pinned campaign is left alone).
  const bookableIds = bookable.map((c) => c.id).join(",");
  useEffect(() => {
    if (!initialCampaignId && !bookable.some((c) => c.id === campaignId)) setCampaignId(bookable[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookableIds]);

  const pageOptionIds = pageOptions.map((a) => a.id).join(",");
  useEffect(() => {
    if (!pageOptions.some((a) => a.id === assetId)) setAssetId(pageOptions[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, pageOptionIds]);

  // Keep the selected format valid when the chosen page changes, preferring
  // a format this page has actually priced.
  useEffect(() => {
    const priced = pricedBookable(asset?.rateCards);
    if (priced.includes(format)) return;
    setFormat(priced[0] ?? STANDARD_FORMATS[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  const bulkMutation = useMutation({
    mutationFn: () => linksApi.bulkCreate(token, { campaignId, assetId, format, urls }),
  });

  const result = bulkMutation.data;
  const pinnedCampaign = campaigns.find((c) => c.id === initialCampaignId);

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[460px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (result) {
            onCreated();
            return;
          }
          bulkMutation.mutate();
        }}
        className="flex flex-col gap-5 overflow-y-auto p-6 pt-1"
      >
        <div>
          <h2 className="text-lg font-semibold">Upload links</h2>
          <p className="mt-1 text-[0.8125rem] text-text-faint">
            {pinnedCampaign ? `For ${pinnedCampaign.title}. ` : ""}Paste one or more post URLs — one per line.
          </p>
        </div>

        {pinnedCampaign ? (
          <Field label="Campaign">
            <div className="flex h-11 items-center rounded-md border border-border-strong bg-surface-2 px-3.5 text-[0.875rem] text-text-muted">
              {pinnedCampaign.title}
            </div>
          </Field>
        ) : (
          <Field label="Campaign">
            <Select value={campaignId} onChange={setCampaignId}>
              {bookable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Page">
          <Select value={assetId} onChange={setAssetId}>
            {pageOptions.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.handle}
              </option>
            ))}
          </Select>
        </Field>

        {pageOptions.length === 0 && (
          <p className="rounded-md border border-border bg-surface-2 px-3.5 py-2.5 text-[0.8125rem] text-text-muted" data-testid="upload-not-booked">
            {bookable.length === 0 ? "None of your pages is booked on a campaign yet." : "None of your pages is booked on this campaign."} Ask your admin to book your page first.
          </p>
        )}

        {quota && (
          <p
            data-testid="upload-quota"
            className={cn(
              "rounded-md border px-3.5 py-2.5 text-[0.8125rem]",
              quota.submitted > quota.booked ? "border-rose/30 bg-rose-soft text-rose" : "border-border bg-surface-2 text-text-muted"
            )}
          >
            {quota.submitted > quota.booked ? (
              <>
                <b className="font-semibold">
                  {quota.submitted} posted, but only {quota.booked} booked.
                </b>{" "}
                Only the first {quota.booked} count — the extra {quota.submitted - quota.booked} won&rsquo;t be paid for.
              </>
            ) : (
              <>
                <b className="font-semibold">
                  {quota.submitted} of {quota.booked} posts
                </b>{" "}
                up for @{asset?.handle}
                {remaining === 0 ? " — that's all of them." : ` — ${remaining} still to upload.`}
              </>
            )}
          </p>
        )}

        <Field label="Format">
          <Select value={format} onChange={setFormat}>
            {availableFormats.map((f) => {
              const priced = asset?.rateCards.some((rc) => rc.format === f);
              return (
                <option key={f} value={f}>
                  {formatLabel(f)}
                  {priced ? "" : " (no rate set)"}
                </option>
              );
            })}
          </Select>
        </Field>

        <Field label={`Post URLs${urls.length > 0 ? ` · ${urls.length}` : ""}`}>
          <textarea
            required
            rows={5}
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            placeholder={"https://instagram.com/reel/…\nhttps://instagram.com/reel/…"}
            className="resize-none rounded-md border border-border-strong bg-surface-2 px-3.5 py-2.5 font-mono text-[0.8125rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-30"
          />
        </Field>

        {result && (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-2 px-3.5 py-2.5 text-[0.8125rem]">
            <p className="font-semibold text-accent">{result.created.length} link{result.created.length === 1 ? "" : "s"} submitted.</p>
            {result.skipped.length > 0 && (
              <div className="flex flex-col gap-0.5 text-text-faint">
                <p className="font-semibold text-rose">{result.skipped.length} skipped:</p>
                {result.skipped.map((s) => (
                  <p key={s.url} className="truncate">
                    {s.url} — {s.reason}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {bulkMutation.isError && (
          <ErrorNotice message={bulkMutation.error instanceof ApiError ? bulkMutation.error.message : "Couldn't submit these links."} />
        )}

        <div className="flex gap-2.5">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button type="submit" className="flex-1" disabled={bulkMutation.isPending || !campaignId || !assetId || urls.length === 0}>
              {bulkMutation.isPending ? "Submitting…" : `Submit${urls.length > 1 ? ` ${urls.length} links` : " link"}`}
            </Button>
          )}
          {result && (
            <Button type="submit" className="flex-1">
              Done
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
