"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/form-field";
import { Tag, type TagTone } from "@/components/ui/tag";
import { Note } from "@/components/ui/note";
import { ErrorNotice } from "@/components/ui/table-parts";
import { UploadIcon, CheckCircleIcon } from "@/components/icons";
import { assets as assetsApi, ApiError, PAGE_CATEGORIES, type ImportPreview, type ImportPreviewRow, type ImportRowStatus, type ImportResult, type ImportScrapedProfile, type PageOwner } from "@/lib/api-client";
import { RefreshIcon } from "@/components/icons";
import { compactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Inventory → "Import pages" (user request, 14 Sep): attach an .xlsx/.csv
 * of pages, see every row with the account it will be registered under
 * before anything is created, fix the rows the sheet couldn't place
 * (blank/unknown owner → pick an account), then confirm. The server does
 * the parsing and resolution (assets/importParser.js + previewImport) and
 * re-validates on confirm; this is the review surface.
 */

const ACCEPTED_EXTENSIONS = ["xlsx", "csv"];
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const STATUS_LABEL: Record<ImportRowStatus, { label: string; tone: TagTone }> = {
  ready: { label: "Will be created", tone: "ok" },
  "owner-missing": { label: "Needs an account", tone: "wait" },
  "owner-unknown": { label: "Account not found", tone: "wait" },
  exists: { label: "Already in Inventory", tone: "neutral" },
  conflict: { label: "Under another account", tone: "bad" },
  duplicate: { label: "Duplicate row", tone: "neutral" },
  invalid: { label: "Invalid handle", tone: "bad" },
};

/** Rows the admin can still turn into a page by choosing an account. */
const PLACEABLE: ImportRowStatus[] = ["ready", "owner-missing", "owner-unknown"];

export function ownerLabel(owner: { name: string | null; phoneNumber: string } | null | undefined) {
  return owner?.name?.trim() || owner?.phoneNumber || "—";
}

export function ImportPagesModal({ token, onClose, onImported }: { token: string; onClose: () => void; onImported: (result: ImportResult) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  // Per-row account choice, keyed by sheet row number. Starts from what the
  // server resolved; the admin can override any placeable row.
  const [ownerByRow, setOwnerByRow] = useState<Record<number, string>>({});
  const [defaultOwnerId, setDefaultOwnerId] = useState("");
  // Per-row category override (user request, 14 Sep — "marking option
  // under category for all or single"); "" = keep what the sheet said.
  const [categoryByRow, setCategoryByRow] = useState<Record<number, string>>({});
  const [categoryForAll, setCategoryForAll] = useState("");
  // Live follower counts / avg views fetched right after the preview.
  const [liveByHandle, setLiveByHandle] = useState<Record<string, ImportScrapedProfile | null>>({});
  const [liveError, setLiveError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  // Guards against a slow first preview landing after a second source was chosen.
  const latestSourceRef = useRef<File | string | null>(null);
  const followersMutation = useMutation({
    mutationFn: async ({ handles, source }: { handles: string[]; source: File | string }) => {
      for (let i = 0; i < handles.length; i += 100) {
        const { profiles } = await assetsApi.importFollowers(token, handles.slice(i, i + 100));
        // A late chunk from a sheet the admin already replaced must not paint the new preview.
        if (latestSourceRef.current !== source) return;
        setLiveByHandle((prev) => ({ ...prev, ...profiles }));
      }
    },
    onError: (err, { source }) => {
      if (latestSourceRef.current !== source) return;
      setLiveError(err instanceof ApiError ? err.message : "Couldn't fetch follower counts right now — they'll be fetched after import.");
    },
  });

  const previewMutation = useMutation({
    // A File (upload) or a Google Sheet share link (user request, 14 Sep —
    // "attaching link of google sheet, not csv export"); either way the
    // server parses it and returns the same per-row preview.
    mutationFn: (source: File | string) => (typeof source === "string" ? assetsApi.previewImportUrl(token, source) : assetsApi.previewImport(token, source)),
    onSuccess: (data, source) => {
      if (latestSourceRef.current !== source) return;
      setPreview(data);
      setCategoryByRow({});
      setCategoryForAll("");
      setLiveByHandle({});
      setLiveError("");
      const handles = [...new Set(data.rows.filter((r) => PLACEABLE.includes(r.status) && r.handle).map((r) => r.handle as string))];
      if (handles.length > 0) followersMutation.mutate({ handles, source });
      setOwnerByRow(Object.fromEntries(data.rows.filter((r) => r.ownerId && PLACEABLE.includes(r.status)).map((r) => [r.rowNumber, r.ownerId as string])));
      setDefaultOwnerId("");
    },
  });

  const importMutation = useMutation({
    mutationFn: () => assetsApi.import(token, rowsToImport),
    onSuccess: (data) => {
      setResult(data);
      onImported(data);
    },
  });

  function clearPreviewState() {
    setPreview(null);
    setResult(null);
    setLiveByHandle({});
    setLiveError("");
    setCategoryByRow({});
    setCategoryForAll("");
  }

  function handleFile(file: File | undefined) {
    setFileError("");
    clearPreviewState();
    if (!file) return;
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setFileError(ext === "xls" ? "Legacy .xls files aren't supported — save it as .xlsx or .csv and try again." : "Upload an Excel (.xlsx) or CSV file.");
      return;
    }
    if (file.size === 0) {
      setFileError("That file is empty.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError("That file is over 5 MB — export just the pages sheet and try again.");
      return;
    }
    setFileName(file.name);
    setSheetUrl("");
    latestSourceRef.current = file;
    previewMutation.mutate(file);
  }

  function fetchSheetLink() {
    const url = sheetUrl.trim();
    setFileError("");
    clearPreviewState();
    if (!/^https:\/\/docs\.google\.com\/spreadsheets\//i.test(url)) {
      setFileError("Paste a Google Sheets link (it starts with https://docs.google.com/spreadsheets/…).");
      return;
    }
    setFileName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    latestSourceRef.current = url;
    previewMutation.mutate(url);
  }

  function resetFile() {
    setFileName("");
    setSheetUrl("");
    setFileError("");
    clearPreviewState();
    latestSourceRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const effectiveOwnerId = (row: ImportPreviewRow) => ownerByRow[row.rowNumber] || defaultOwnerId || "";
  const effectiveCategory = (row: ImportPreviewRow) => categoryByRow[row.rowNumber] ?? row.category ?? "";
  const liveFor = (row: ImportPreviewRow) => (row.handle ? liveByHandle[row.handle] : undefined);

  const rowsToImport = useMemo(() => {
    if (!preview) return [];
    return preview.rows
      .filter((r) => PLACEABLE.includes(r.status) && r.handle && effectiveOwnerId(r))
      .map((r) => ({ handle: r.handle as string, ownerId: effectiveOwnerId(r), category: effectiveCategory(r) || null, followers: liveFor(r)?.followers ?? r.followers, rateCards: r.rateCards }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, ownerByRow, defaultOwnerId, categoryByRow, liveByHandle]);

  // "Keep sheet values" (empty) drops every override so the sheet's own
  // categories come back; a real category replaces them all, including
  // any the admin had set row by row before.
  function applyCategoryToAll(category: string) {
    setCategoryForAll(category);
    if (!preview || !category) {
      setCategoryByRow({});
      return;
    }
    setCategoryByRow(Object.fromEntries(preview.rows.filter((r) => PLACEABLE.includes(r.status) && r.handle).map((r) => [r.rowNumber, category])));
  }

  // Per row, the empty option means "back to what the sheet said".
  function setRowCategory(rowNumber: number, category: string) {
    setCategoryByRow((prev) => {
      const next = { ...prev };
      if (category) next[rowNumber] = category;
      else delete next[rowNumber];
      return next;
    });
  }

  const unplacedCount = preview ? preview.rows.filter((r) => PLACEABLE.includes(r.status) && r.handle && !effectiveOwnerId(r)).length : 0;
  // Any placeable row without a per-row choice (including a resolved one the admin cleared) is what the default picker is for.
  const needsDefault = preview ? preview.rows.some((r) => PLACEABLE.includes(r.status) && Boolean(r.handle) && !ownerByRow[r.rowNumber]) : false;

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[900px]">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6 pt-1" data-testid="import-pages-modal">
        <div className="mb-4">
          <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">Import pages</h2>
          <p className="mt-1 text-[0.8125rem] text-text-muted">
            Paste a Google Sheet link or attach an Excel/CSV file. Each row becomes a page under the creator account it names — review the list below before anything is created.
          </p>
        </div>

        {result ? (
          <ResultView result={result} onClose={onClose} />
        ) : (
          <>
            <div className="flex flex-col gap-3 rounded-[10px] border border-dashed border-border-strong bg-surface-2 p-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-[0.78rem] font-medium text-text-2">Google Sheet link</span>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <TextField
                      type="url"
                      value={sheetUrl}
                      onChange={setSheetUrl}
                      placeholder="https://docs.google.com/spreadsheets/…"
                      aria-label="Google Sheet link"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          fetchSheetLink();
                        }
                      }}
                    />
                  </div>
                  <Button type="button" variant="secondary" onClick={fetchSheetLink} disabled={!sheetUrl.trim() || previewMutation.isPending} data-testid="import-fetch-sheet">
                    Fetch sheet
                  </Button>
                </div>
                <p className="text-[0.72rem] text-text-muted">The sheet must be shared as &ldquo;Anyone with the link can view&rdquo;. The first tab is used.</p>
              </div>
              <div className="flex items-center gap-3 text-[0.72rem] uppercase tracking-wide text-text-faint">
                <span className="h-px flex-1 bg-border" />
                or upload a file
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 py-2 text-[0.8125rem] font-semibold text-text shadow-card hover:bg-surface-2">
                  <UploadIcon className="h-4 w-4" />
                  {fileName ? "Choose another file" : "Choose file"}
                  <input ref={fileInputRef} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="hidden" aria-label="Pages sheet (.xlsx or .csv)" onChange={(e) => handleFile(e.target.files?.[0])} />
                </label>
                {fileName && (
                  <span className="text-[0.8125rem] text-text-2" data-testid="import-file-name">
                    {fileName}
                  </span>
                )}
                {previewMutation.isPending && <span className="text-[0.8125rem] text-text-muted">{typeof latestSourceRef.current === "string" ? "Fetching sheet…" : "Reading sheet…"}</span>}
              </div>
              <p className="text-[0.75rem] text-text-muted">
                Columns: <b>handle</b> (required — also accepts @handle or a profile link), <b>owner</b> (phone number, email or name of the creator account), and optionally <b>category</b>, <b>followers</b>, and a rate per format (<b>reel</b>, <b>story</b>, …). The first sheet of a workbook is used.
              </p>
            </div>

            {fileError && <ErrorNotice message={fileError} />}
            {previewMutation.isError && <ErrorNotice message={previewMutation.error instanceof ApiError ? previewMutation.error.message : "Couldn't read that sheet."} />}

            {preview && (
              <PreviewView
                preview={preview}
                ownerByRow={ownerByRow}
                setOwnerByRow={setOwnerByRow}
                defaultOwnerId={defaultOwnerId}
                setDefaultOwnerId={setDefaultOwnerId}
                effectiveOwnerId={effectiveOwnerId}
                needsDefault={needsDefault}
                unplacedCount={unplacedCount}
                categoryByRow={categoryByRow}
                setRowCategory={setRowCategory}
                categoryForAll={categoryForAll}
                applyCategoryToAll={applyCategoryToAll}
                liveByHandle={liveByHandle}
                liveFetching={followersMutation.isPending}
                liveError={liveError}
              />
            )}

            {importMutation.isError && <ErrorNotice message={importMutation.error instanceof ApiError ? importMutation.error.message : "Couldn't import those pages."} />}

            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              {preview && (
                <Button type="button" variant="ghost" onClick={resetFile}>
                  Start over
                </Button>
              )}
              <div className="ml-auto flex items-center gap-3">
                {preview && unplacedCount > 0 && (
                  <span className="text-[0.78rem] text-text-muted" data-testid="import-unplaced">
                    {unplacedCount} row{unplacedCount === 1 ? "" : "s"} still need an account
                  </span>
                )}
                <Button type="button" onClick={() => importMutation.mutate()} disabled={!preview || rowsToImport.length === 0 || importMutation.isPending} data-testid="import-confirm">
                  {importMutation.isPending ? "Importing…" : `Import ${rowsToImport.length} page${rowsToImport.length === 1 ? "" : "s"}`}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

function PreviewView({
  preview,
  ownerByRow,
  setOwnerByRow,
  defaultOwnerId,
  setDefaultOwnerId,
  effectiveOwnerId,
  needsDefault,
  unplacedCount,
  categoryByRow,
  setRowCategory,
  categoryForAll,
  applyCategoryToAll,
  liveByHandle,
  liveFetching,
  liveError,
}: {
  preview: ImportPreview;
  ownerByRow: Record<number, string>;
  setOwnerByRow: (updater: (prev: Record<number, string>) => Record<number, string>) => void;
  defaultOwnerId: string;
  setDefaultOwnerId: (v: string) => void;
  effectiveOwnerId: (row: ImportPreviewRow) => string;
  needsDefault: boolean;
  unplacedCount: number;
  categoryByRow: Record<number, string>;
  setRowCategory: (rowNumber: number, category: string) => void;
  categoryForAll: string;
  applyCategoryToAll: (category: string) => void;
  liveByHandle: Record<string, ImportScrapedProfile | null>;
  liveFetching: boolean;
  liveError: string;
}) {
  const s = preview.summary;
  const skippedCount = (s.exists ?? 0) + (s.conflict ?? 0) + (s.duplicate ?? 0) + (s.invalid ?? 0);
  const ownerOptions = preview.owners;
  // Standard categories plus anything the sheet itself used, so a sheet's
  // own labels stay pickable per row.
  const categoryOptions = [...new Set([...PAGE_CATEGORIES, ...preview.rows.map((r) => r.category).filter((c): c is string => Boolean(c))])];

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[0.78rem]" data-testid="import-summary">
        <span className="font-semibold">{preview.totalRows} row{preview.totalRows === 1 ? "" : "s"} read.</span>
        {Object.entries(STATUS_LABEL).map(([status, meta]) => {
          const n = s[status as ImportRowStatus] ?? 0;
          if (!n) return null;
          return (
            <Tag key={status} tone={meta.tone} dot={false}>
              {n} {meta.label.toLowerCase()}
            </Tag>
          );
        })}
      </div>

      {ownerOptions.length === 0 && <Note tone="warn">There are no creator accounts yet — create one on the Users page first, then import.</Note>}

      {needsDefault && ownerOptions.length > 0 && (
        <Note tone="info" className="items-center">
          <div className="flex flex-wrap items-center gap-3">
            <span>{preview.hasOwnerColumn ? "Some rows don't name an account the app knows." : "This sheet has no owner column."} Put those pages under:</span>
            <select value={defaultOwnerId} onChange={(e) => setDefaultOwnerId(e.target.value)} aria-label="Default account for rows without one" className="h-8 rounded-[6px] border border-border-strong bg-surface px-2 text-[0.8125rem] text-text">
              <option value="">Pick an account…</option>
              {ownerOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {ownerOptionLabel(o)}
                </option>
              ))}
            </select>
          </div>
        </Note>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.78rem]">
        <label className="flex items-center gap-2">
          <span className="text-text-muted">Category for all</span>
          <CategorySelect value={categoryForAll} onChange={applyCategoryToAll} options={categoryOptions} aria-label="Category for all rows" placeholder="Keep sheet values" />
        </label>
        <span className="inline-flex items-center gap-1.5 text-text-muted" data-testid="live-followers-status">
          {liveFetching ? (
            <>
              <RefreshIcon className="h-3 w-3 animate-spin" />
              Fetching followers from Instagram…
            </>
          ) : liveError ? (
            <span className="text-rose">{liveError}</span>
          ) : Object.keys(liveByHandle).length > 0 ? (
            "Followers and avg views are live from Instagram."
          ) : null}
        </span>
      </div>

      {skippedCount > 0 && unplacedCount === 0 && <p className="text-[0.75rem] text-text-muted">Rows marked already in Inventory, duplicate, invalid, or under another account are skipped — hover a status for the reason.</p>}

      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full min-w-[720px] table-fixed border-collapse text-[0.8125rem]" data-testid="import-preview-table">
          <thead className="bg-surface-2 text-[0.72rem] font-medium uppercase tracking-wide text-text-muted">
            <tr>
              <th className="w-12 px-3 py-2 text-left">Row</th>
              <th className="px-3 py-2 text-left">Page</th>
              <th className="w-36 px-3 py-2 text-left">Category</th>
              <th className="w-28 px-3 py-2 text-right">Followers</th>
              <th className="w-56 px-3 py-2 text-left">Account</th>
              <th className="w-44 px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => {
              const placeable = PLACEABLE.includes(row.status) && Boolean(row.handle);
              const chosen = effectiveOwnerId(row);
              const meta = STATUS_LABEL[row.status];
              const shownStatus = placeable && chosen ? STATUS_LABEL.ready : placeable && !chosen ? STATUS_LABEL["owner-missing"] : meta;
              return (
                <tr key={row.rowNumber} data-testid="import-preview-row" data-status={row.status} className={cn("border-t border-border", !placeable && "text-text-muted")}>
                  <td className="px-3 py-2 tabular-nums text-text-muted">{row.rowNumber}</td>
                  <td className="px-3 py-2">
                    <div className="truncate font-semibold">{row.handle ? `@${row.handle}` : row.rawHandle || "—"}</div>
                    {row.handle && row.rawHandle !== row.handle && row.rawHandle !== `@${row.handle}` && <div className="truncate text-[0.72rem] text-text-faint">{row.rawHandle}</div>}
                    {row.rateCards.length > 0 && <div className="text-[0.72rem] text-text-faint">{row.rateCards.map((rc) => `${rc.format} ₹${rc.amount.toLocaleString("en-IN")}`).join(" · ")}</div>}
                  </td>
                  <td className="px-3 py-2">
                    {placeable ? (
                      <CategorySelect value={categoryByRow[row.rowNumber] ?? ""} onChange={(v) => setRowCategory(row.rowNumber, v)} options={categoryOptions} aria-label={`Category for @${row.handle}`} placeholder={row.category ? `Sheet: ${row.category}` : "—"} />
                    ) : (
                      <span className="truncate">{row.category ?? <span className="text-text-faint">—</span>}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <FollowersCell row={row} live={row.handle ? liveByHandle[row.handle] : undefined} fetching={placeable && liveFetching} />
                  </td>
                  <td className="px-3 py-2">
                    {placeable && ownerOptions.length > 0 ? (
                      <select
                        value={ownerByRow[row.rowNumber] ?? ""}
                        onChange={(e) => setOwnerByRow((prev) => ({ ...prev, [row.rowNumber]: e.target.value }))}
                        aria-label={`Account for @${row.handle}`}
                        className={cn("h-8 w-full rounded-[6px] border bg-surface px-2 text-[0.8125rem] text-text", chosen ? "border-border-strong" : "border-accent-2-line")}
                      >
                        <option value="">{defaultOwnerId ? `Default (${ownerOptionLabel(ownerOptions.find((o) => o.id === defaultOwnerId))})` : "Pick an account…"}</option>
                        {ownerOptions.map((o) => (
                          <option key={o.id} value={o.id}>
                            {ownerOptionLabel(o)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{ownerLabel(row.owner)}</span>
                    )}
                    {row.ownerRef && row.status === "owner-unknown" && <div className="truncate text-[0.72rem] text-text-faint">Sheet said: {row.ownerRef}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <span title={row.reason ?? undefined}>
                      <Tag tone={shownStatus.tone} dot={false}>
                        {shownStatus.label}
                      </Tag>
                    </span>
                    {row.reason && !placeable && <div className="mt-0.5 text-[0.72rem] text-text-faint">{row.reason}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CategorySelect({ value, onChange, options, placeholder, "aria-label": ariaLabel }: { value: string; onChange: (v: string) => void; options: string[]; placeholder: string; "aria-label": string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel} className="h-8 w-full max-w-[180px] rounded-[6px] border border-border-strong bg-surface px-2 text-[0.8125rem] text-text">
      <option value="">{placeholder}</option>
      {options.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

/** Sheet value first, replaced by the live Instagram count once it lands; null live = private/missing profile. */
function FollowersCell({ row, live, fetching }: { row: ImportPreviewRow; live: ImportScrapedProfile | null | undefined; fetching: boolean }) {
  if (live) {
    return (
      <span title={live.avgViews != null ? `Avg views ${compactNumber(live.avgViews)}` : undefined} data-testid="live-followers">
        {compactNumber(live.followers)}
        {live.avgViews != null && <span className="block text-[0.7rem] text-text-faint">{compactNumber(live.avgViews)} avg views</span>}
      </span>
    );
  }
  if (live === null) {
    return (
      <span>
        {row.followers === null ? <span className="text-text-faint">—</span> : compactNumber(row.followers)}
        <span className="block text-[0.7rem] text-rose">Not found on Instagram</span>
      </span>
    );
  }
  return (
    <span>
      {row.followers === null ? <span className="text-text-faint">—</span> : compactNumber(row.followers)}
      {fetching && <span className="block text-[0.7rem] text-text-faint">fetching…</span>}
    </span>
  );
}

function ownerOptionLabel(o: PageOwner | undefined) {
  if (!o) return "—";
  return o.name?.trim() ? `${o.name} · ${o.phoneNumber}` : o.phoneNumber;
}

function ResultView({ result, onClose }: { result: ImportResult; onClose: () => void }) {
  const byOwner = new Map<string, { owner: ImportResult["created"][number]["owner"]; handles: string[] }>();
  for (const a of result.created) {
    const entry = byOwner.get(a.owner.id) ?? { owner: a.owner, handles: [] };
    entry.handles.push(a.handle);
    byOwner.set(a.owner.id, entry);
  }
  return (
    <div className="flex flex-col gap-4" data-testid="import-result">
      <Note tone={result.created.length > 0 ? "ok" : "warn"}>
        <span className="font-semibold">
          {result.created.length} page{result.created.length === 1 ? "" : "s"} imported
        </span>
        {result.skipped.length > 0 && <span> · {result.skipped.length} skipped</span>}
        {result.created.length > 0 && <span className="block text-[0.75rem] opacity-80">Approved on creation. Followers and average views already fetched in the preview are saved with the page; anything still missing fills in from Instagram in the background.</span>}
      </Note>

      {byOwner.size > 0 && (
        <div className="flex flex-col gap-2">
          {[...byOwner.values()].map(({ owner, handles }) => (
            <div key={owner.id} className="rounded-[10px] border border-border px-3.5 py-2.5">
              <div className="flex items-center gap-2 text-[0.8125rem] font-semibold">
                <CheckCircleIcon className="h-4 w-4 text-accent" />
                {ownerLabel(owner)}
                <span className="font-normal text-text-muted">· {handles.length} page{handles.length === 1 ? "" : "s"}</span>
              </div>
              <p className="mt-1 text-[0.78rem] text-text-2">{handles.map((h) => `@${h}`).join(", ")}</p>
            </div>
          ))}
        </div>
      )}

      {result.skipped.length > 0 && (
        <div className="rounded-[10px] border border-border bg-surface-2 px-3.5 py-2.5 text-[0.78rem]">
          <p className="font-semibold text-rose">Skipped</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-text-2">
            {result.skipped.map((s, i) => (
              <li key={`${s.handle}-${i}`}>
                @{s.handle} — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
