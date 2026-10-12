"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Loader2, Sheet as SheetIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CARD, FIELD, MICRO, errorMessage, fadeRise } from "@/components/bulk-track/shared";
import { bulkTrack as bulkTrackApi } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

// Mirrors the server's row rules (bulkTrack/service.js rowTargets) so the
// preview counts exactly the rows an import would take.
const MAX_ROWS_PER_IMPORT = 100;
const isPostUrl = (url: string) => /instagram\.com\/(reels?|p)\//i.test(url);
function profileUsername(url: string): string | null {
  const m = url.match(/instagram\.com\/([a-zA-Z0-9_.]+)/i);
  if (!m) return null;
  const u = m[1].toLowerCase();
  return ["p", "reel", "reels", "tv", "stories", "explore"].includes(u) ? null : u;
}

/**
 * "Connect a Google Sheet" (the source's ConnectSheetCard): preview the
 * sheet's columns, map them (auto-picked by header name), choose what to
 * fetch from Apify, see a live row / Apify-call estimate, then import.
 */
export function ConnectSheetCard({ onConnected, index = 0 }: { onConnected: () => void; index?: number }) {
  const { accessToken } = useAuth();
  const token = accessToken!;
  const [sheetUrl, setSheetUrl] = useState("");
  const [name, setName] = useState("");
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [profileLinkCol, setProfileLinkCol] = useState("");
  const [postLinkCol, setPostLinkCol] = useState("");
  const [categoryCol, setCategoryCol] = useState("");
  const [followersCol, setFollowersCol] = useState("");
  const [dateCol, setDateCol] = useState("");
  const [pageNameCol, setPageNameCol] = useState("");
  // What to spend Apify calls on — anything unticked is read from the sheet only.
  const [fetchFollowers, setFetchFollowers] = useState(true);
  const [fetchEngagement, setFetchEngagement] = useState(true);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const preview = useMutation({
    mutationFn: () => bulkTrackApi.previewSheet(token, { sheetUrl }),
    onSuccess: (data) => {
      setHeaders(data.headers);
      setPreviewRows(data.rows ?? []);
      setTotalRows(data.rowCount ?? 0);
      setError(null);
      // Best-effort auto-pick so a skipped column mapping isn't the default path.
      const findHeader = (re: RegExp) => data.headers.find((h) => re.test(h));
      setProfileLinkCol((prev) => prev || findHeader(/(page|profile|account).*(link|url)|(link|url).*(page|profile|account)/i) || "");
      setPostLinkCol((prev) => prev || findHeader(/(post|reel).*(link|url)|(link|url).*(post|reel)/i) || "");
      setCategoryCol((prev) => prev || findHeader(/categor|genre/i) || "");
      setFollowersCol((prev) => prev || findHeader(/follow/i) || "");
      setDateCol((prev) => prev || findHeader(/date/i) || "");
      setPageNameCol((prev) => prev || findHeader(/\bname\b/i) || "");
    },
    onError: (err) => {
      setError(errorMessage(err, "Couldn't read that sheet"));
      setHeaders(null);
    },
  });

  const connect = useMutation({
    mutationFn: () =>
      bulkTrackApi.connectSheet(token, {
        sheetUrl,
        name: name.trim() || undefined,
        profileLinkCol: profileLinkCol || undefined,
        postLinkCol: postLinkCol || undefined,
        categoryCol: categoryCol || undefined,
        followersCol: followersCol || undefined,
        dateCol: dateCol || undefined,
        pageNameCol: pageNameCol || undefined,
        fetchFollowers,
        fetchEngagement,
      }),
    onSuccess: () => {
      setSheetUrl("");
      setName("");
      setHeaders(null);
      setProfileLinkCol("");
      setPostLinkCol("");
      setCategoryCol("");
      setFollowersCol("");
      setDateCol("");
      setPageNameCol("");
      setFetchFollowers(true);
      setFetchEngagement(true);
      setPreviewRows([]);
      setTotalRows(0);
      setError(null);
      onConnected();
    },
    onError: (err) => setError(errorMessage(err, "Couldn't connect that sheet")),
  });

  // One per sheet row; Apify calls = one per post link + one per distinct page.
  const summary = useMemo(() => {
    let rows = 0;
    let postCalls = 0;
    const pages = new Set<string>();
    for (const row of previewRows.slice(0, MAX_ROWS_PER_IMPORT)) {
      const hasPost = Boolean(postLinkCol && row[postLinkCol] && isPostUrl(row[postLinkCol]));
      const page = fetchFollowers && profileLinkCol && row[profileLinkCol] ? profileUsername(row[profileLinkCol]) : null;
      if (!(fetchEngagement && hasPost) && !page) continue;
      rows++;
      if (fetchEngagement && hasPost) postCalls++;
      if (page) pages.add(page);
    }
    return { rows, postCalls, profileCalls: pages.size };
  }, [previewRows, postLinkCol, profileLinkCol, fetchFollowers, fetchEngagement]);

  const missingFollowersCol = fetchFollowers && !profileLinkCol;
  const missingEngagementCol = fetchEngagement && !postLinkCol;
  const canConnect = (fetchFollowers || fetchEngagement) && !missingFollowersCol && !missingEngagementCol && summary.rows > 0;

  const columnFields = [
    { label: "Page name column", value: pageNameCol, set: setPageNameCol },
    { label: "Profile link column", value: profileLinkCol, set: setProfileLinkCol },
    { label: "Post link column", value: postLinkCol, set: setPostLinkCol },
    { label: "Followers column", value: followersCol, set: setFollowersCol },
    { label: "Date column", value: dateCol, set: setDateCol },
    { label: "Category column (optional)", value: categoryCol, set: setCategoryCol },
  ];

  return (
    <motion.div {...fadeRise(index)} className={cn(CARD, "p-5")} data-testid="bulk-connect-sheet">
      <div className="mb-1 flex items-center gap-2">
        <SheetIcon size={14} className="text-accent" />
        <h3 className="text-sm font-bold">Connect a Google Sheet</h3>
      </div>
      <p className="mb-4 text-xs text-text-faint">Must be shared as &quot;Anyone with the link can view&quot; — use &quot;Check now&quot; to pull in new rows whenever you&apos;re ready.</p>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          value={sheetUrl}
          onChange={(e) => {
            setSheetUrl(e.target.value);
            setHeaders(null);
          }}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          aria-label="Google Sheet URL"
          className={cn(FIELD, "flex-1 font-mono")}
        />
        <Button variant="secondary" size="sm" onClick={() => preview.mutate()} disabled={!sheetUrl.trim() || preview.isPending} className="h-auto shrink-0 py-2">
          {preview.isPending ? <Loader2 className="animate-spin" /> : null}
          Preview columns
        </Button>
      </div>

      <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Name (optional) — e.g. Competitor Reels Q3" aria-label="Sheet name" className={cn(FIELD, "mb-3")} />

      {error && <p className="mb-3 text-xs text-rose">{error}</p>}

      {headers && headers.length > 0 && (
        <div className="mb-3 grid grid-cols-1 gap-3 rounded-md bg-surface-2 p-3 sm:grid-cols-3">
          {columnFields.map((f) => (
            <div key={f.label}>
              <label className={`${MICRO} mb-1 block`}>
                {f.label}
                <select
                  value={f.value}
                  onChange={(e) => f.set(e.target.value)}
                  className="mt-1 w-full rounded-[8px] border border-border bg-surface px-2 py-1.5 text-xs normal-case tracking-normal text-text focus:border-border-strong focus:outline-none"
                >
                  <option value="">None</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>
      )}

      {headers && headers.length > 0 && (
        <div className="mb-3 rounded-md bg-surface-2 p-3">
          <p className={`${MICRO} mb-2`}>What to fetch from Apify</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-5">
            {[
              { label: "Followers", hint: "profile scrape", checked: fetchFollowers, set: setFetchFollowers },
              { label: "Post engagement", hint: "views, likes, comments, shares, saves", checked: fetchEngagement, set: setFetchEngagement },
            ].map((o) => (
              <label key={o.label} className="flex cursor-pointer items-center gap-2 text-xs text-text">
                <input type="checkbox" checked={o.checked} onChange={(e) => o.set(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
                <span className="font-medium">{o.label}</span>
                <span className="text-text-faint">({o.hint})</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-text-faint">Anything unticked is taken from the sheet only and still appears in the Excel export.</p>
          {!fetchFollowers && !fetchEngagement && <p className="mt-1.5 text-[11px] text-rose">Tick at least one.</p>}
          {missingFollowersCol && <p className="mt-1.5 text-[11px] text-rose">Map a profile link column to fetch followers.</p>}
          {missingEngagementCol && <p className="mt-1.5 text-[11px] text-rose">Map a post link column to fetch post engagement.</p>}
          {(fetchFollowers || fetchEngagement) && (
            <p className="mt-2 text-xs tabular-nums text-text-muted">
              <span className="font-semibold text-text">{summary.rows} rows</span> will be imported
              {totalRows > MAX_ROWS_PER_IMPORT && ` (first ${MAX_ROWS_PER_IMPORT} of ${totalRows} sheet rows)`}
              {" · "}~{summary.postCalls + summary.profileCalls} Apify calls
              {fetchFollowers && fetchEngagement && ` (${summary.postCalls} posts + ${summary.profileCalls} profiles)`}
            </p>
          )}
        </div>
      )}

      {headers && postLinkCol && !followersCol && !fetchFollowers && (
        <p className="mb-3 text-xs text-accent-2">Followers aren&apos;t being fetched and no followers column is mapped — the export will have no follower counts.</p>
      )}

      {headers && (
        <Button size="sm" onClick={() => connect.mutate()} disabled={!canConnect || connect.isPending}>
          {connect.isPending ? <Loader2 className="animate-spin" /> : null}
          Connect &amp; import
        </Button>
      )}
    </motion.div>
  );
}
