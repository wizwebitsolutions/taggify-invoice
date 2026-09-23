"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextField, PhoneField } from "@/components/ui/form-field";
import { Tag, type TagTone } from "@/components/ui/tag";
import { Note } from "@/components/ui/note";
import { ErrorNotice } from "@/components/ui/table-parts";
import { UploadIcon, CheckCircleIcon, DownloadIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { assets as assetsApi, auth as authApi, ApiError, hasAccess, PAGE_CATEGORIES, type ImportPreview, type ImportPreviewRow, type ImportRowStatus, type ImportResult, type ImportScrapedProfile, type PageOwner } from "@/lib/api-client";
import { RefreshIcon } from "@/components/icons";
import { compactNumber, money } from "@/lib/format";
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

/**
 * Whether Instagram confirmed a placeable row's page (user request, 22 Sep —
 * "if page not found, showing with message link broken or not found and it
 * won't be stored"). Only "found" rows are sent to import; the server
 * re-checks and refuses the rest regardless.
 */
type CheckState = "found" | "not-found" | "unverified" | "checking";
const CHECK_LABEL: Record<Exclude<CheckState, "found">, { label: string; tone: TagTone; reason: string }> = {
  "not-found": { label: "Link broken / not found", tone: "bad", reason: "Won't be imported — fix the link in the sheet." },
  unverified: { label: "Couldn't verify", tone: "wait", reason: "Couldn't check this page on Instagram — retry the check; it won't be imported until it's confirmed." },
  checking: { label: "Checking…", tone: "neutral", reason: "Looking the page up on Instagram." },
};

/** Below Tailwind's `md` — where the preview switches from the table to one card per page. */
function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return narrow;
}

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
  // Accounts created from this popup (22 Sep — "creation of new user option
  // under which all the pages will be associated"), and the new account's
  // one-time password, which has to stay visible until the popup closes.
  const [extraOwners, setExtraOwners] = useState<PageOwner[]>([]);
  const [newUser, setNewUser] = useState<{ owner: PageOwner; password: string } | null>(null);
  const templateMutation = useMutation({ mutationFn: () => assetsApi.downloadImportTemplate(token) });

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
      setLiveError(err instanceof ApiError ? err.message : "Couldn't check these pages on Instagram right now — retry the check.");
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

  const fetchingLink = previewMutation.isPending && typeof latestSourceRef.current === "string";
  const effectiveOwnerId = (row: ImportPreviewRow) => ownerByRow[row.rowNumber] || defaultOwnerId || "";
  const effectiveCategory = (row: ImportPreviewRow) => categoryByRow[row.rowNumber] ?? row.category ?? "";
  const liveFor = (row: ImportPreviewRow) => (row.handle ? liveByHandle[row.handle] : undefined);
  const checkState = (row: ImportPreviewRow): CheckState => {
    const live = liveFor(row);
    if (live) return "found";
    if (live === null) return "not-found";
    return followersMutation.isPending ? "checking" : "unverified";
  };
  const isPlaceable = (row: ImportPreviewRow) => PLACEABLE.includes(row.status) && Boolean(row.handle);

  const rowsToImport = useMemo(() => {
    if (!preview) return [];
    return preview.rows
      .filter((r) => isPlaceable(r) && checkState(r) === "found" && effectiveOwnerId(r))
      .map((r) => ({ handle: r.handle as string, ownerId: effectiveOwnerId(r), category: effectiveCategory(r) || null, pageName: r.pageName ?? null, followers: liveFor(r)?.followers ?? r.followers, rateCards: r.rateCards }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, ownerByRow, defaultOwnerId, categoryByRow, liveByHandle, followersMutation.isPending]);

  // "Not found" is re-checkable too: a lookup can drop a profile Instagram
  // rate-limited, and re-checking a genuinely broken link just confirms it.
  const unverifiedHandles = preview ? [...new Set(preview.rows.filter((r) => isPlaceable(r) && ["unverified", "not-found"].includes(checkState(r))).map((r) => r.handle as string))] : [];
  function retryCheck() {
    if (!latestSourceRef.current || unverifiedHandles.length === 0) return;
    setLiveError("");
    followersMutation.mutate({ handles: unverifiedHandles, source: latestSourceRef.current });
  }

  // "Import all pages under" means all of them — a row the sheet had placed
  // under someone else follows too (it can still be switched on its own row).
  function chooseAccountForAll(ownerId: string) {
    setDefaultOwnerId(ownerId);
    setOwnerByRow({});
  }

  function onUserCreated(owner: PageOwner, password: string | null) {
    setExtraOwners((prev) => (prev.some((o) => o.id === owner.id) ? prev : [...prev, owner]));
    setDefaultOwnerId(owner.id);
    // Rows the sheet had placed elsewhere follow the new account too — "all the pages will be associated" with it.
    setOwnerByRow({});
    if (password) setNewUser({ owner, password });
  }

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

  // Broken / unverified links won't be imported whatever account they get, so they don't count as waiting for one.
  const unplacedCount = preview ? preview.rows.filter((r) => isPlaceable(r) && ["found", "checking"].includes(checkState(r)) && !effectiveOwnerId(r)).length : 0;
  // Any placeable row without a per-row choice (including a resolved one the admin cleared) is what the default picker is for.
  const needsDefault = preview ? preview.rows.some((r) => PLACEABLE.includes(r.status) && Boolean(r.handle) && !ownerByRow[r.rowNumber]) : false;

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[1080px]">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6 pt-1" data-testid="import-pages-modal">
        <div className="mb-4">
          <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">Import pages</h2>
          <p className="mt-1 text-[0.8125rem] text-text-muted">
            Paste a Google Sheet link or attach an Excel/CSV file. Every page is looked up on Instagram from its link, and you choose (or create) the account they go under — review the list below before anything is created.
          </p>
        </div>

        {newUser && <NewUserPassword newUser={newUser} />}

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
                    {fetchingLink && <RefreshIcon className="h-3.5 w-3.5 animate-spin" />}
                    {fetchingLink ? "Fetching…" : "Fetch sheet"}
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
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[0.75rem] text-text-muted">
                  Columns: <b>Page Name</b>, <b>Page Link</b> (required — the page&apos;s Instagram profile link), <b>Followers</b>, <b>Reel Rate</b>, <b>Story Rate</b>. The first sheet of a workbook is used.
                </p>
                <Button type="button" variant="secondary" size="sm" onClick={() => templateMutation.mutate()} disabled={templateMutation.isPending} data-testid="import-download-template">
                  <DownloadIcon className="h-3.5 w-3.5" />
                  {templateMutation.isPending ? "Downloading…" : "Download template"}
                </Button>
              </div>
              {templateMutation.isError && <ErrorNotice message={templateMutation.error instanceof ApiError ? templateMutation.error.message : "Couldn't download the template."} />}
            </div>

            {fileError && <ErrorNotice message={fileError} />}
            {previewMutation.isError && <ErrorNotice message={previewMutation.error instanceof ApiError ? previewMutation.error.message : "Couldn't read that sheet."} />}

            {/* 22 Sep — "it should show while fetching from google sheet": a
                link fetch goes Google → our server → here and can take a few
                seconds, so the space the preview will fill says so. */}
            {previewMutation.isPending && <PreviewLoading fromLink={fetchingLink} />}

            {preview && (
              <PreviewView
                preview={preview}
                ownerByRow={ownerByRow}
                setOwnerByRow={setOwnerByRow}
                defaultOwnerId={defaultOwnerId}
                setDefaultOwnerId={chooseAccountForAll}
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
                checkState={checkState}
                unverifiedCount={unverifiedHandles.length}
                onRetryCheck={retryCheck}
                owners={[...preview.owners, ...extraOwners.filter((o) => !preview.owners.some((p) => p.id === o.id))]}
                token={token}
                onUserCreated={onUserCreated}
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
                <Button
                  type="button"
                  onClick={() => importMutation.mutate()}
                  disabled={!preview || rowsToImport.length === 0 || importMutation.isPending || followersMutation.isPending}
                  data-testid="import-confirm"
                >
                  {importMutation.isPending ? "Importing…" : followersMutation.isPending ? "Checking pages on Instagram…" : `Import ${rowsToImport.length} page${rowsToImport.length === 1 ? "" : "s"}`}
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
  checkState,
  unverifiedCount,
  onRetryCheck,
  owners,
  token,
  onUserCreated,
}: {
  checkState: (row: ImportPreviewRow) => CheckState;
  unverifiedCount: number;
  onRetryCheck: () => void;
  owners: PageOwner[];
  token: string;
  onUserCreated: (owner: PageOwner, password: string | null) => void;
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
  const ownerOptions = owners;
  // 22 Sep — "if page already exists under any user, please handle that
  // edge case should show in popup": listed together, up front, with who
  // they're under, rather than only as a status buried in the table.
  const alreadyExisting = preview.rows.filter((r) => r.status === "exists" || r.status === "conflict");
  const notFoundCount = preview.rows.filter((r) => PLACEABLE.includes(r.status) && r.handle && checkState(r) === "not-found").length;
  const narrow = useIsNarrow();

  // Everything a row's status/controls depend on, shared by the table and the phone cards.
  function describeRow(row: ImportPreviewRow) {
    const check = PLACEABLE.includes(row.status) && Boolean(row.handle) ? checkState(row) : null;
    // A page Instagram didn't confirm drops out like any other skipped row.
    const placeable = check === "found" || check === "checking";
    const chosen = effectiveOwnerId(row);
    const checkMeta = check && check !== "found" ? CHECK_LABEL[check] : null;
    const shownStatus = checkMeta ?? (placeable && chosen ? STATUS_LABEL.ready : placeable && !chosen ? STATUS_LABEL["owner-missing"] : STATUS_LABEL[row.status]);
    const shownReason = checkMeta?.reason ?? row.reason;
    return { placeable, chosen, shownStatus, shownReason };
  }
  type RowView = ReturnType<typeof describeRow>;

  function pageCell(row: ImportPreviewRow) {
    return (
      <>
        {row.pageName && (
          <div className="truncate font-semibold text-text" title={row.pageName}>
            {row.pageName}
          </div>
        )}
        {row.handle ? (
          // The page the link resolved to, opening the real profile — easy to spot a wrong link before importing.
          <a
            href={`https://www.instagram.com/${row.handle}/`}
            target="_blank"
            rel="noreferrer"
            className={cn("block truncate hover:underline", row.pageName ? "text-[0.78rem] text-text-2" : "font-semibold text-text")}
          >
            @{row.handle}
          </a>
        ) : (
          <div className="truncate text-[0.78rem]" title={row.rawHandle}>
            {row.rawHandle || "—"}
          </div>
        )}
      </>
    );
  }

  function categoryControl(row: ImportPreviewRow, _v: RowView) {
    return (
      <CategorySelect
        value={categoryByRow[row.rowNumber] ?? ""}
        onChange={(value) => setRowCategory(row.rowNumber, value)}
        options={categoryOptions}
        aria-label={`Category for @${row.handle}`}
        placeholder={row.category ? `Sheet: ${row.category}` : "No category"}
        wide={narrow}
      />
    );
  }

  function accountControl(row: ImportPreviewRow, v: RowView) {
    const allPagesOwner = ownerOptions.find((o) => o.id === defaultOwnerId);
    return (
      <div>
        <select
          value={ownerByRow[row.rowNumber] ?? ""}
          onChange={(e) => setOwnerByRow((prev) => ({ ...prev, [row.rowNumber]: e.target.value }))}
          aria-label={`Account for @${row.handle}`}
          className={cn("h-8 w-full rounded-[6px] border bg-surface px-2 text-[0.8125rem] text-text", v.chosen ? "border-border-strong" : "border-accent-2-line")}
        >
          {/* Just the name — the phone is on the "Import all pages under" picker above, and repeating it truncated on every row was noise. */}
          <option value="">{allPagesOwner ? ownerLabel(allPagesOwner) : "Pick an account…"}</option>
          {ownerOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {ownerOptionLabel(o)}
            </option>
          ))}
        </select>
        {row.ownerRef && row.status === "owner-unknown" && <div className="truncate text-[0.72rem] text-text-faint">Sheet said: {row.ownerRef}</div>}
      </div>
    );
  }

  function statusBadge(v: RowView) {
    return (
      <div>
        <span title={v.shownReason ?? undefined} data-testid="import-row-status">
          <Tag tone={v.shownStatus.tone} dot={false}>
            {v.shownStatus.label}
          </Tag>
        </span>
        {v.shownReason && !v.placeable && <div className="mt-0.5 text-[0.72rem] text-text-faint">{v.shownReason}</div>}
      </div>
    );
  }

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
          // The server's first read of the sheet — once an account is chosen for every page, "needs an account" no longer applies.
          if ((status === "owner-missing" || status === "owner-unknown") && unplacedCount === 0) return null;
          return (
            <Tag key={status} tone={meta.tone} dot={false}>
              {n} {meta.label.toLowerCase()}
            </Tag>
          );
        })}
      </div>

      <ImportAccountPicker
        owners={ownerOptions}
        defaultOwnerId={defaultOwnerId}
        setDefaultOwnerId={setDefaultOwnerId}
        hint={needsDefault ? (preview.hasOwnerColumn ? "Some rows don't name an account the app knows." : null) : "Every row already names its account — pick one here to put them all under it instead."}
        token={token}
        onUserCreated={onUserCreated}
      />

      {alreadyExisting.length > 0 && (
        <div data-testid="import-already-exists">
        <Note tone="warn">
          <span className="font-semibold">
            {alreadyExisting.length} page{alreadyExisting.length === 1 ? " is" : "s are"} already in Inventory and won&apos;t be imported:
          </span>
          <ul className="mt-1 flex flex-col gap-0.5">
            {alreadyExisting.map((r) => (
              <li key={r.rowNumber}>
                @{r.handle} — under <b>{ownerLabel(r.owner)}</b>
              </li>
            ))}
          </ul>
        </Note>
        </div>
      )}

      {notFoundCount > 0 && (
        <div data-testid="import-not-found">
        <Note tone="warn">
          <span className="font-semibold">
            {notFoundCount} link{notFoundCount === 1 ? " is" : "s are"} broken or the page wasn&apos;t found on Instagram.
          </span>{" "}
          {notFoundCount === 1 ? "It" : "They"} won&apos;t be imported — fix the link in the sheet and import it again.
        </Note>
        </div>
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
        {!liveFetching && unverifiedCount > 0 && (
          <Button type="button" variant="secondary" size="sm" onClick={onRetryCheck} data-testid="import-retry-check">
            <RefreshIcon className="h-3 w-3" />
            Re-check {unverifiedCount} page{unverifiedCount === 1 ? "" : "s"}
          </Button>
        )}
      </div>

      {skippedCount > 0 && unplacedCount === 0 && <p className="text-[0.75rem] text-text-muted">Rows marked already in Inventory, duplicate, invalid, or under another account are skipped — hover a status for the reason.</p>}

      {/* Desktop: one table that scrolls inside itself with a sticky header.
          Phone: a card per page, so followers / reel rate / status aren't
          pushed off-screen by a sideways-scrolling table. Only one layout is
          ever rendered, so each row's controls exist exactly once. */}
      {narrow ? (
        <div className="flex flex-col gap-2.5" data-testid="import-preview-cards">
          {preview.rows.map((row) => {
            const v = describeRow(row);
            return (
              <div
                key={row.rowNumber}
                data-testid="import-preview-row"
                data-status={row.status}
                className={cn("flex flex-col gap-2.5 rounded-[10px] border border-border p-3.5 text-[0.8125rem]", !v.placeable && "bg-surface-2/40 text-text-muted")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">{pageCell(row)}</div>
                  <span className="shrink-0 text-[0.72rem] tabular-nums text-text-faint">Row {row.rowNumber}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-surface-2 px-2.5 py-1.5">
                    <div className="text-[0.66rem] font-medium uppercase tracking-wide text-text-faint">Followers</div>
                    <div className="tabular-nums">
                      <FollowersCell row={row} live={row.handle ? liveByHandle[row.handle] : undefined} fetching={v.placeable && liveFetching} />
                    </div>
                  </div>
                  <div className="rounded-md bg-surface-2 px-2.5 py-1.5">
                    <div className="text-[0.66rem] font-medium uppercase tracking-wide text-text-faint">Reel rate</div>
                    <div className="tabular-nums">
                      <ReelRateCell rateCards={row.rateCards} />
                    </div>
                  </div>
                </div>
                {v.placeable && (
                  <div className="grid grid-cols-1 gap-2">
                    {categoryControl(row, v)}
                    {accountControl(row, v)}
                  </div>
                )}
                {statusBadge(v)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="max-h-[480px] overflow-auto rounded-[10px] border border-border">
          <table className="w-full min-w-[980px] table-fixed border-collapse text-[0.8125rem]" data-testid="import-preview-table">
            <thead className="sticky top-0 z-10 bg-surface-2 text-[0.7rem] font-medium uppercase tracking-wide text-text-muted shadow-[0_1px_0_var(--border)]">
              <tr>
                <th className="w-12 px-3 py-2.5 text-left">Row</th>
                <th className="px-3 py-2.5 text-left">Page</th>
                <th className="w-40 px-3 py-2.5 text-left">Category</th>
                <th className="w-28 px-3 py-2.5 text-right">Followers</th>
                <th className="w-28 px-3 py-2.5 text-right">Reel rate</th>
                <th className="w-52 px-3 py-2.5 text-left">Account</th>
                <th className="w-40 px-3 py-2.5 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => {
                const v = describeRow(row);
                return (
                  <tr
                    key={row.rowNumber}
                    data-testid="import-preview-row"
                    data-status={row.status}
                    className={cn("border-t border-border align-middle transition-colors", v.placeable ? "hover:bg-surface-2/60" : "bg-surface-2/40 text-text-muted")}
                  >
                    <td className="px-3 py-2.5 tabular-nums text-text-faint">{row.rowNumber}</td>
                    <td className="px-3 py-2.5">{pageCell(row)}</td>
                    <td className="px-3 py-2.5">{v.placeable ? categoryControl(row, v) : <span className="truncate">{row.category ?? <span className="text-text-faint">—</span>}</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <FollowersCell row={row} live={row.handle ? liveByHandle[row.handle] : undefined} fetching={v.placeable && liveFetching} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <ReelRateCell rateCards={row.rateCards} />
                    </td>
                    <td className="px-3 py-2.5">{v.placeable && ownerOptions.length > 0 ? accountControl(row, v) : <span>{ownerLabel(row.owner)}</span>}</td>
                    <td className="px-3 py-2.5">{statusBadge(v)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * "Import all pages under" (user request, 22 Sep — "creation of new user
 * option under which all the pages will be associated"). Pick an existing
 * creator, or create one right here — same POST /auth/signup the Users page
 * uses, as a CREATOR with a generated password. Whichever is chosen becomes
 * the account for every row (a single row can still be switched below).
 */
function ImportAccountPicker({
  owners,
  defaultOwnerId,
  setDefaultOwnerId,
  hint,
  token,
  onUserCreated,
}: {
  owners: PageOwner[];
  defaultOwnerId: string;
  setDefaultOwnerId: (id: string) => void;
  hint: string | null;
  token: string;
  onUserCreated: (owner: PageOwner, password: string | null) => void;
}) {
  // Creating an account is POST /auth/signup, which needs users.manage — a
  // sub-admin with only inventory.manage picks an existing account instead.
  const { user } = useAuth();
  const canCreateUser = hasAccess(user, "users.edit");
  const [creating, setCreating] = useState(owners.length === 0 && canCreateUser);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const phoneValid = phone.length === 10;

  const createMutation = useMutation({
    mutationFn: async () => {
      const phoneNumber = `+91${phone}`;
      try {
        const { user, generatedPassword } = await authApi.signup(token, { phoneNumber, name: name.trim() || undefined, role: "CREATOR" });
        return { owner: { id: user.id, name: user.name, phoneNumber: user.phoneNumber }, password: generatedPassword as string | null };
      } catch (err) {
        // That number is already a creator here — use them rather than failing.
        const existing = owners.find((o) => o.phoneNumber === phoneNumber);
        if (err instanceof ApiError && err.code === "PHONE_ALREADY_REGISTERED" && existing) return { owner: existing, password: null };
        if (err instanceof ApiError && err.code === "PHONE_ALREADY_REGISTERED") throw new ApiError(409, err.code, "That phone number already belongs to an account that isn't a creator — use a different number.");
        throw err;
      }
    },
    onSuccess: ({ owner, password }) => {
      onUserCreated(owner, password);
      setCreating(false);
      setName("");
      setPhone("");
      setPhoneTouched(false);
    },
  });

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-border bg-surface-2 px-3.5 py-3" data-testid="import-account-picker">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[0.8125rem] font-semibold">Import all pages under</span>
        {owners.length > 0 && (
          <select
            value={defaultOwnerId}
            onChange={(e) => setDefaultOwnerId(e.target.value)}
            aria-label="Account for all pages"
            className={cn("h-8 min-w-[220px] rounded-[6px] border bg-surface px-2 text-[0.8125rem] text-text", defaultOwnerId ? "border-border-strong" : "border-accent-2-line")}
          >
            <option value="">Pick an account…</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {ownerOptionLabel(o)}
              </option>
            ))}
          </select>
        )}
        {owners.length === 0 && !canCreateUser && <span className="text-[0.8125rem] text-text-muted">No creator accounts yet — ask an admin to create one on the Users page.</span>}
        {!creating && canCreateUser && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setCreating(true)} data-testid="import-new-user">
            + Create new user
          </Button>
        )}
      </div>
      {hint && !creating && <p className="text-[0.75rem] text-text-muted">{hint}</p>}

      {creating && (
        <form
          className="flex flex-wrap items-end gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            setPhoneTouched(true);
            if (phoneValid) createMutation.mutate();
          }}
          data-testid="import-new-user-form"
        >
          <label className="flex min-w-[180px] flex-1 flex-col gap-1">
            <span className="text-[0.72rem] font-medium text-text-2">Name</span>
            <TextField value={name} onChange={setName} placeholder="Creator's name" aria-label="New user name" />
          </label>
          <label className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className="text-[0.72rem] font-medium text-text-2">Phone number</span>
            <PhoneField value={phone} onChange={setPhone} onBlur={() => setPhoneTouched(true)} aria-label="New user phone" error={phoneTouched && !phoneValid ? "Enter a 10-digit mobile number." : undefined} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create user"}
            </Button>
            {owners.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            )}
          </div>
          {createMutation.isError && (
            <div className="w-full">
              <ErrorNotice message={createMutation.error instanceof ApiError ? createMutation.error.message : "Couldn't create that user."} />
            </div>
          )}
        </form>
      )}
    </div>
  );
}

/** The new account's password is shown once, and stays up until the popup closes. */
function NewUserPassword({ newUser }: { newUser: { owner: PageOwner; password: string } }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mb-4" data-testid="import-new-user-password">
      <Note tone="ok">
        <span className="font-semibold">Created {ownerOptionLabel(newUser.owner)}.</span> Share this password with them now — it&apos;s shown only this once:
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <code className="rounded-[6px] border border-border-strong bg-surface px-2.5 py-1 font-mono text-[0.9375rem] font-semibold tracking-wide text-text">{newUser.password}</code>
          <button
            type="button"
            className="text-[0.78rem] font-semibold underline underline-offset-2"
            onClick={() => {
              navigator.clipboard?.writeText(newUser.password).then(() => setCopied(true), () => {});
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </Note>
    </div>
  );
}

function CategorySelect({ value, onChange, options, placeholder, wide, "aria-label": ariaLabel }: { value: string; onChange: (v: string) => void; options: string[]; placeholder: string; wide?: boolean; "aria-label": string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel} className={cn("h-8 w-full rounded-[6px] border border-border-strong bg-surface px-2 text-[0.8125rem] text-text", !wide && "max-w-[180px]")}>
      <option value="">{placeholder}</option>
      {options.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

/** The sheet's reel rate (22 Sep — "add reel cost of that page"), with the story rate as a quieter second line. */
function ReelRateCell({ rateCards }: { rateCards: ImportPreviewRow["rateCards"] }) {
  const reel = rateCards.find((rc) => rc.format === "reel");
  const story = rateCards.find((rc) => rc.format === "story");
  return (
    <span data-testid="import-reel-rate">
      {reel ? <span className="font-semibold text-text">{money(reel.amount)}</span> : <span className="text-text-faint" title="No reel rate in the sheet">—</span>}
      {story && <span className="block text-[0.7rem] text-text-faint">Story {money(story.amount)}</span>}
    </span>
  );
}

/** What the preview area shows while a sheet is being fetched or read. */
function PreviewLoading({ fromLink }: { fromLink: boolean }) {
  return (
    <div className="mt-4 overflow-hidden rounded-[10px] border border-border" role="status" aria-live="polite" data-testid="import-loading">
      <div className="flex items-start gap-2.5 border-b border-border bg-surface-2 px-4 py-3 text-[0.8125rem]">
        <RefreshIcon className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-text-muted" />
        <div className="min-w-0">
          <p className="font-semibold">{fromLink ? "Fetching your Google Sheet…" : "Reading your file…"}</p>
          <p className="text-text-muted">{fromLink ? "Downloading the first tab from Google and matching each page — this can take a few seconds." : "Matching each row to Inventory and accounts."}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2.5 p-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-3 w-6 animate-pulse rounded bg-surface-2" />
            <div className="h-8 flex-1 animate-pulse rounded-md bg-surface-2" style={{ animationDelay: `${i * 120}ms` }} />
            <div className="h-8 w-24 animate-pulse rounded-md bg-surface-2" style={{ animationDelay: `${i * 120}ms` }} />
            <div className="h-8 w-24 animate-pulse rounded-md bg-surface-2" style={{ animationDelay: `${i * 120}ms` }} />
          </div>
        ))}
      </div>
    </div>
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
    // Nothing to count — the row's status already says the page wasn't found.
    return <span className="text-text-faint" title="Not found on Instagram">—</span>;
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
        {result.created.length > 0 && <span className="block text-[0.75rem] opacity-80">Approved on creation, with the followers, average views and profile details confirmed on Instagram. Profile pictures are saved in the background.</span>}
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
