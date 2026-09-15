"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, Select } from "@/components/ui/form-field";
import { ErrorNotice } from "@/components/ui/table-parts";
import { links as linksApi, ApiError, LINK_FORMATS } from "@/lib/api-client";

// Standard formats every page should be able to post — mirrors the Assets
// rate-card editor's list. A page's rate card only needs *some* of these
// priced (unpriced ones just fail with "No rate card set…" per link when
// submitted), but every page should still see the full set here rather
// than only whichever formats happen to already have a price.
const STANDARD_FORMATS = [...LINK_FORMATS];

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
  campaigns: { id: string; title: string }[];
  assets: { id: string; handle: string; rateCards: { format: string }[] }[];
  initialCampaignId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [campaignId, setCampaignId] = useState(initialCampaignId ?? campaigns[0]?.id ?? "");
  const [assetId, setAssetId] = useState(assets[0]?.id ?? "");
  const [urlsText, setUrlsText] = useState("");
  const [format, setFormat] = useState(assets[0]?.rateCards[0]?.format ?? STANDARD_FORMATS[0]);

  const asset = assets.find((a) => a.id === assetId);
  const urls = urlsText.split("\n").map((u) => u.trim()).filter(Boolean);

  // reel/story only (14 Sep) — a legacy rate card with another format is
  // not offered for new submissions.
  const availableFormats = [...STANDARD_FORMATS];

  // Keep the selected format valid when the chosen page changes, preferring
  // a format this page has actually priced.
  useEffect(() => {
    const priced = asset?.rateCards.map((rc) => rc.format) ?? [];
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
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Page">
          <Select value={assetId} onChange={setAssetId}>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.handle}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Format">
          <Select value={format} onChange={setFormat}>
            {availableFormats.map((f) => {
              const priced = asset?.rateCards.some((rc) => rc.format === f);
              return (
                <option key={f} value={f}>
                  {f}
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
