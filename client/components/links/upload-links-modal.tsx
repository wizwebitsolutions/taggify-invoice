"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form-field";
import { ErrorNotice } from "@/components/ui/table-parts";
import { links as linksApi, ApiError } from "@/lib/api-client";

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
  const [format, setFormat] = useState(assets[0]?.rateCards[0]?.format ?? "reel");

  const asset = assets.find((a) => a.id === assetId);
  const urls = urlsText.split("\n").map((u) => u.trim()).filter(Boolean);

  const bulkMutation = useMutation({
    mutationFn: () => linksApi.bulkCreate(token, { campaignId, assetId, format, urls }),
  });

  const result = bulkMutation.data;
  const pinnedCampaign = campaigns.find((c) => c.id === initialCampaignId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (result) {
            onCreated();
            return;
          }
          bulkMutation.mutate();
        }}
        className="flex w-full max-w-[460px] flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-card"
      >
        <div>
          <h2 className="text-lg font-bold">Upload links</h2>
          <p className="mt-1 text-[0.8125rem] text-text-faint">
            {pinnedCampaign ? `For ${pinnedCampaign.title}. ` : ""}Paste one or more post URLs — one per line.
          </p>
        </div>

        {pinnedCampaign ? (
          <Field label="Campaign">
            <div className="flex h-11 items-center rounded-md border border-border-strong bg-surface-2 px-3.5 text-[0.9375rem] text-text-muted">
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
            {(asset?.rateCards ?? []).map((rc) => (
              <option key={rc.format} value={rc.format}>
                {rc.format}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={`Post URLs${urls.length > 0 ? ` · ${urls.length}` : ""}`}>
          <textarea
            required
            rows={5}
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            placeholder={"https://instagram.com/reel/…\nhttps://instagram.com/reel/…"}
            className="resize-none rounded-md border border-border-strong bg-surface-2 px-3.5 py-2.5 font-mono text-[0.8125rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
    </div>
  );
}
