"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, Download, FileSpreadsheet, RefreshCw, Upload, UserPlus } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import {
  ApiError,
  assets as assetsApi,
  auth as authApi,
  PAGE_CATEGORIES,
  type ImportNewVendor,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportResult,
  type ImportRowStatus,
  type ImportScrapedProfile,
  type PageOwner,
} from "@/lib/api-client";
import { canCreateLogin } from "@/lib/creators";
import { compactNumber, money, personLabel, plural } from "@/lib/format";
import { invalidatePages } from "@/lib/queries/creators";
import { FORMATS, formatLabel, joinLabels } from "@/lib/formats";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field } from "@/components/taggify/field";
import { Money } from "@/components/taggify/money";
import { SegmentedFilter } from "@/components/taggify/segmented-filter";
import { StatusPill, type StatusTone } from "@/components/taggify/status-pill";
import { audienceLabel, displayHandle } from "@/components/finance/identity";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FOLLOWERS_CHUNK = 100;
// The lookup runs as a server job (3 Nov); the server's own Apify wait is 240 s, so give up a little after that.
const FOLLOWERS_POLL_MS = 3000;
const FOLLOWERS_POLL_LIMIT_MS = 5 * 60 * 1000;
/** Select items can't carry "", so "keep what the sheet / the all-pages picker says" uses these. */
const SHEET = "__sheet";
const DEFAULT = "__default";

const STATUS: Record<ImportRowStatus, { label: string; tone: StatusTone }> = {
  ready: { label: "Ready", tone: "success" },
  "owner-missing": { label: "Needs a creator", tone: "warning" },
  "owner-unknown": { label: "Creator not found", tone: "warning" },
  exists: { label: "Already in Inventory", tone: "neutral" },
  // Already in Inventory and the sheet changes it (1 Nov): imported as an edit.
  update: { label: "Will be updated", tone: "info" },
  conflict: { label: "Under another creator", tone: "danger" },
  duplicate: { label: "Duplicate row", tone: "neutral" },
  invalid: { label: "Not a page link", tone: "danger" },
  incomplete: { label: "Missing required cells", tone: "danger" },
};
/** Rows that become a page once they have a creator. */
const PLACEABLE: ImportRowStatus[] = ["ready", "owner-missing", "owner-unknown"];
/** An "update" row: its page exists already, keeps its creator and needs no Instagram check. */
const isUpdate = (r: ImportPreviewRow) => r.status === "update" && !!r.handle;

/** "Grade — → A · Reel ₹5,000 → ₹6,000" — what an update row changes, from the preview's `changes` and `current`. */
function changesSummary(r: ImportPreviewRow) {
  const c = r.changes ?? {};
  const now = r.current;
  const parts: string[] = [];
  if ("category" in c) parts.push(`Category ${now?.category ?? "—"} → ${c.category ?? "—"}`);
  if ("grade" in c) parts.push(`Grade ${now?.grade ?? "—"} → ${c.grade ?? "—"}`);
  if ("groupLink" in c) parts.push("Group link");
  for (const rc of c.rateCards ?? []) {
    const before = now?.rateCards.find((x) => x.format === rc.format)?.amount;
    parts.push(`${formatLabel(rc.format)} ${before != null ? money(before) : "—"} → ${money(rc.amount)}`);
  }
  return parts.join(" · ");
}

/** Whether Instagram confirmed a placeable row's page. Only "found" rows are imported; the server re-checks. */
type CheckState = "found" | "not-found" | "unverified" | "checking";
const CHECK: Record<Exclude<CheckState, "found">, { label: string; tone: StatusTone; note: string }> = {
  "not-found": { label: "Not on Instagram", tone: "danger", note: "The link is broken or the page doesn't exist. Fix it in the sheet." },
  unverified: { label: "Not checked", tone: "warning", note: "Couldn't look this page up on Instagram. Check again before importing." },
  checking: { label: "Checking…", tone: "neutral", note: "Looking the page up on Instagram." },
};

type NewLogin = { owner: PageOwner; password: string };
/** A login made here: `password` is null when the email already had a creator account (matched, nothing created). */
type CreatedLogin = { owner: PageOwner; password: string | null; matched?: boolean };

const emailOk = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim());
/** "+91 98765 43210" / "09876543210" / "9876543210" → "9876543210": the 10 local digits we send as +91…. */
const localPhone = (v: string) => {
  const d = v.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  return d;
};
const phoneOk = (v: string) => [0, 10].includes(localPhone(v).length);

/**
 * A new creator login (POST /auth/signup as CREATOR; users.edit, or a planner with
 * inventory.edit). An email that already belongs to one of `owners` maps to that
 * account instead. Used by "New creator" and by "New vendors found".
 */
function useCreateCreatorLogin(owners: PageOwner[]) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return async ({ email, name, phone }: { email: string; name?: string | null; phone?: string | null }): Promise<CreatedLogin> => {
    const normalized = email.trim().toLowerCase();
    const digits = localPhone(phone ?? "");
    let login: CreatedLogin;
    try {
      const r = await authApi.signup(accessToken!, { email: normalized, name: name?.trim() || undefined, phoneNumber: digits ? `+91${digits}` : undefined, role: "CREATOR" });
      login = { owner: { id: r.user.id, name: r.user.name, phoneNumber: r.user.phoneNumber ?? null, email: r.user.email }, password: (r.generatedPassword as string | null) ?? null };
    } catch (e) {
      const existing = owners.find((o) => o.email?.toLowerCase() === normalized);
      // The mobile can clash too (it's unique per account): an existing creator with it is that vendor (14 Oct review).
      const byPhone = digits ? owners.find((o) => localPhone(o.phoneNumber ?? "") === digits) : undefined;
      if (e instanceof ApiError && e.code === "EMAIL_ALREADY_REGISTERED" && existing) login = { owner: existing, password: null, matched: true };
      else if (e instanceof ApiError && e.code === "PHONE_ALREADY_REGISTERED" && byPhone) login = { owner: byPhone, password: null, matched: true };
      else if (e instanceof ApiError && e.code === "PHONE_ALREADY_REGISTERED") throw new Error("That mobile number already belongs to an account that isn't a creator. Change it or leave it empty.");
      else if (e instanceof ApiError && e.status === 409) throw new Error("That email already has an account that isn't a creator. Use a different email.");
      else throw e;
    }
    // A new creator login shows up in People and the page-owner pickers.
    qc.invalidateQueries({ queryKey: ["adminUsers"] });
    qc.invalidateQueries({ queryKey: ["assets", "owners"] });
    return login;
  };
}

/**
 * Creators → "Import pages" (POST /assets/import/*, inventory.edit): an Excel/CSV
 * file or a Google Sheet link of pages. The server reads the sheet and resolves
 * each row's creator; every page is then looked up on Instagram. You pick (or
 * create) the creator for rows the sheet couldn't place, see every row's status,
 * and only confirmed pages are created. An admin's pages are approved on import;
 * anyone else's wait for approval. The sheet's rates are kept either way (1 Nov),
 * except on a creator's own sheet. A row whose page is already in Inventory is
 * an edit: an admin's changes are applied, anyone else's go for approval.
 */
export function ImportPagesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-5xl">{open && <ImportFlow onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function ImportFlow({ onClose }: { onClose: () => void }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  // Literal role check, like the server's importAssets: only an admin's pages are approved on import, and only an admin's edits apply straight away.
  const isAdmin = user?.role === "ADMIN";
  // A creator's sheet is all their own pages; there's no creator to pick.
  const isCreator = user?.role === "CREATOR";

  const [source, setSource] = useState<"file" | "sheet">("file");
  const [sheetUrl, setSheetUrl] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  // Per-row creator and category, keyed by sheet row number. Rows without one use the "all pages" choice / the sheet.
  const [ownerByRow, setOwnerByRow] = useState<Record<number, string>>({});
  const [ownerForAll, setOwnerForAll] = useState("");
  // Rows given to an approved vendor's account: "Import all pages under" leaves them alone.
  const [vendorRows, setVendorRows] = useState<Record<number, string>>({});
  const [categoryByRow, setCategoryByRow] = useState<Record<number, string>>({});
  const [categoryForAll, setCategoryForAll] = useState(SHEET);
  const [live, setLive] = useState<Record<string, ImportScrapedProfile | null>>({});
  const [liveError, setLiveError] = useState<string | null>(null);
  const [extraOwners, setExtraOwners] = useState<PageOwner[]>([]);
  // Every login made in this dialog, with its one-time password, until it closes.
  const [newLogins, setNewLogins] = useState<NewLogin[]>([]);
  // Bumped on every read, so the new-vendors panel starts fresh for a new sheet.
  const [readCount, setReadCount] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  // A slow read or lookup for a sheet that was already replaced must not paint the new one.
  const latest = useRef<File | string | null>(null);
  // Closing the dialog stops any follower-check polling still running for its sheet.
  useEffect(() => () => {
    latest.current = null;
  }, []);

  const template = useMutation({
    mutationFn: () => assetsApi.downloadImportTemplate(accessToken!),
    onError: (e) => toast.error(errText(e, "Couldn't download the template. Try again.")),
  });

  const lookup = useMutation({
    mutationFn: async ({ handles, src }: { handles: string[]; src: File | string }) => {
      for (let i = 0; i < handles.length; i += FOLLOWERS_CHUNK) {
        const { jobId } = await assetsApi.startImportFollowers(accessToken!, handles.slice(i, i + FOLLOWERS_CHUNK));
        if (latest.current !== src) return;
        const deadline = Date.now() + FOLLOWERS_POLL_LIMIT_MS;
        for (;;) {
          await new Promise((r) => setTimeout(r, FOLLOWERS_POLL_MS));
          if (latest.current !== src) return;
          const job = await assetsApi.importFollowersJob(accessToken!, jobId);
          if (latest.current !== src) return;
          if (job.status === "done") {
            setLive((prev) => ({ ...prev, ...job.profiles }));
            break;
          }
          if (Date.now() > deadline) throw new Error("Instagram is taking too long to answer. Retry the check.");
        }
      }
    },
    onError: (e, { src }) => {
      if (latest.current === src) setLiveError(errText(e, "Couldn't look these pages up on Instagram right now."));
    },
  });

  const read = useMutation({
    mutationFn: (src: File | string) => (typeof src === "string" ? assetsApi.previewImportUrl(accessToken!, src) : assetsApi.previewImport(accessToken!, src)),
    onSuccess: (data, src) => {
      if (latest.current !== src) return;
      if (data.rows.length === 0) return setReadError("No rows found. The first row should be the column names, with one page per row under it.");
      setReadError(null);
      setPreview(data);
      setReadCount((n) => n + 1);
      setOwnerByRow(Object.fromEntries(data.rows.filter((r) => r.ownerId && PLACEABLE.includes(r.status)).map((r) => [r.rowNumber, r.ownerId as string])));
      setOwnerForAll("");
      setVendorRows({});
      setCategoryByRow({});
      setCategoryForAll(SHEET);
      setLive({});
      setLiveError(null);
      const handles = [...new Set(data.rows.filter((r) => PLACEABLE.includes(r.status) && r.handle).map((r) => r.handle as string))];
      if (handles.length) lookup.mutate({ handles, src });
    },
    onError: (e, src) => {
      if (latest.current === src) setReadError(errText(e, "Couldn't read that sheet. Check it's an Excel or CSV file, or a shared Google Sheet link."));
    },
  });

  function readFile(f: File) {
    const ext = f.name.toLowerCase().split(".").pop() ?? "";
    if (ext !== "xlsx" && ext !== "csv") return setReadError(ext === "xls" ? "Old .xls files can't be read. Save it as .xlsx or .csv and try again." : "Choose an Excel (.xlsx) or CSV file.");
    if (f.size === 0) return setReadError("That file is empty.");
    if (f.size > MAX_FILE_BYTES) return setReadError("That file is over 5 MB. Keep just the pages sheet and try again.");
    setReadError(null);
    setFileName(f.name);
    latest.current = f;
    read.mutate(f);
  }

  function readLink() {
    const url = sheetUrl.trim();
    if (!/^https:\/\/docs\.google\.com\/spreadsheets\//i.test(url)) return setReadError("Paste a Google Sheets link. It starts with https://docs.google.com/spreadsheets/");
    setReadError(null);
    setFileName(null);
    latest.current = url;
    read.mutate(url);
  }

  function startOver() {
    latest.current = null;
    setPreview(null);
    setFileName(null);
    setLive({});
    setLiveError(null);
    run.reset();
  }

  const placeable = (r: ImportPreviewRow) => (PLACEABLE.includes(r.status) || isUpdate(r)) && !!r.handle;
  const checkOf = (r: ImportPreviewRow): CheckState => {
    // A page already in Inventory was confirmed on Instagram when it was added.
    if (isUpdate(r)) return "found";
    const p = r.handle ? live[r.handle] : undefined;
    if (p) return "found";
    if (p === null) return "not-found";
    return lookup.isPending ? "checking" : "unverified";
  };
  // An update row stays under the creator it already has.
  const ownerOf = (r: ImportPreviewRow) => (isUpdate(r) ? (r.ownerId ?? "") : ownerByRow[r.rowNumber] || ownerForAll || "");
  const categoryOf = (r: ImportPreviewRow) => categoryByRow[r.rowNumber] ?? r.category ?? "";

  const toImport = useMemo(() => {
    if (!preview) return [];
    return preview.rows
      .filter((r) => placeable(r) && checkOf(r) === "found" && (isCreator || ownerOf(r)))
      .map((r) => ({
        handle: r.handle as string,
        // The server puts a creator's rows under the creator whatever is sent.
        ownerId: isCreator ? (user?.id ?? "") : ownerOf(r),
        // An update row changes only what its sheet row says — the category pickers never touch an existing page.
        category: isUpdate(r) ? (r.category ?? null) : categoryOf(r) || null,
        grade: r.grade ?? null,
        groupLink: r.groupLink ?? null,
        pageName: r.pageName ?? null,
        followers: (r.handle ? live[r.handle]?.followers : undefined) ?? r.followers,
        rateCards: r.rateCards,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, ownerByRow, ownerForAll, categoryByRow, live, lookup.isPending, isCreator, user?.id]);

  const recheck = preview ? [...new Set(preview.rows.filter((r) => placeable(r) && (checkOf(r) === "unverified" || checkOf(r) === "not-found")).map((r) => r.handle as string))] : [];
  const waitingForCreator = !preview || isCreator ? 0 : preview.rows.filter((r) => placeable(r) && (checkOf(r) === "found" || checkOf(r) === "checking") && !ownerOf(r)).length;

  const updating = toImport.filter((row) => preview?.rows.some((r) => isUpdate(r) && r.handle === row.handle)).length;
  const creating = toImport.length - updating;

  const run = useMutation({
    mutationFn: () => assetsApi.import(accessToken!, toImport),
    onSuccess: async (r) => {
      setResult(r);
      const updated = r.updated?.length ?? 0;
      const proposed = r.proposed?.length ?? 0;
      if (r.created.length || updated || proposed) {
        await invalidatePages(qc);
        const bits = [r.created.length ? `${plural(r.created.length, "page")} imported` : "", updated ? `${updated} updated` : "", proposed ? `${proposed} sent for approval` : ""].filter(Boolean);
        toast.success(`${bits.join(", ")}.`);
      }
    },
  });

  const owners = useMemo(() => (preview ? [...preview.owners, ...extraOwners.filter((o) => !preview.owners.some((p) => p.id === o.id))] : extraOwners), [preview, extraOwners]);

  function addLogin(login: CreatedLogin) {
    setExtraOwners((prev) => (prev.some((o) => o.id === login.owner.id) ? prev : [...prev, login.owner]));
    const { password } = login;
    if (password) setNewLogins((prev) => (prev.some((l) => l.owner.id === login.owner.id) ? prev : [...prev, { owner: login.owner, password }]));
  }

  function onCreatedLogin(login: CreatedLogin) {
    addLogin(login);
    // "Import all pages under" the new creator: rows the sheet placed elsewhere follow too (each row can still be switched).
    setOwnerForAll(login.owner.id);
    setOwnerByRow(vendorRows);
  }

  /** A new vendor's account (created or matched): just that vendor's rows go under it. */
  function onVendorAccount(login: CreatedLogin, rowNumbers: number[]) {
    addLogin(login);
    const assigned = Object.fromEntries(rowNumbers.map((n) => [n, login.owner.id]));
    setVendorRows((prev) => ({ ...prev, ...assigned }));
    setOwnerByRow((prev) => ({ ...prev, ...assigned }));
  }

  const passwordCard = newLogins.length > 0 && (
    <div className="flex flex-col gap-2">
      {newLogins.map((l) => (
        <PasswordCard key={l.owner.id} login={l} />
      ))}
    </div>
  );

  if (result) return <ResultView result={result} isAdmin={isAdmin} passwordCard={passwordCard} onClose={onClose} />;

  if (preview) {
    const notFound = preview.rows.filter((r) => placeable(r) && checkOf(r) === "not-found").length;
    const already = preview.rows.filter((r) => r.status === "exists" || r.status === "conflict");
    const categories = [...new Set([...PAGE_CATEGORIES, ...preview.rows.map((r) => r.category).filter((c): c is string => !!c)])];
    const leftOut = preview.rows.length - preview.rows.filter(placeable).length;
    return (
      <>
        <DialogHeader>
          <DialogTitle>Check the pages</DialogTitle>
          <DialogDescription>
            {fileName ?? "Google Sheet"}: {plural(preview.totalRows, "row")}.{" "}
            {leftOut ? `${plural(leftOut, "row")} can't be imported and will be left out. ` : ""}
            {isAdmin
              ? "New pages are approved on import with the sheet's rates. Pages already in Inventory are updated straight away."
              : isCreator
                ? "Pages wait for an admin's approval. Changes to your pages are sent to an admin to apply."
                : "New pages wait for an admin's approval, with the rates from the sheet. Changes to pages already in Inventory are sent to an admin to apply."}
          </DialogDescription>
        </DialogHeader>

        {passwordCard}

        {!isCreator && (preview.newVendors?.length ?? 0) > 0 && <NewVendorsPanel key={readCount} vendors={preview.newVendors!} rows={preview.rows} owners={owners} onAccount={onVendorAccount} />}

        {!isCreator && (
          <CreatorForAll
            owners={owners}
            value={ownerForAll}
            onChange={(id) => {
              setOwnerForAll(id);
              setOwnerByRow(vendorRows);
            }}
            hint={preview.rows.some((r) => placeable(r) && !ownerByRow[r.rowNumber]) ? (preview.hasOwnerColumn ? "Some rows name a creator the app doesn't know." : null) : "Every row already names its creator. Pick one here to put them all under it instead."}
            onCreated={onCreatedLogin}
          />
        )}

        {already.length > 0 && (
          <div className="rounded-card bg-warning-soft px-4 py-3 text-small text-warning-fg">
            <p className="text-body-strong">{already.length === 1 ? "1 page is already in Inventory and won't be imported:" : `${already.length} pages are already in Inventory and won't be imported:`}</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {already.map((r) => (
                <li key={r.rowNumber}>
                  {/* For a conflict, `owner` is who the sheet meant; the reason names who it's really under. */}
                  {displayHandle(r.handle ?? r.rawHandle)}: {r.status === "exists" ? `under ${personLabel(r.owner)}` : r.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        {notFound > 0 && (
          <p className="rounded-card bg-danger-soft px-4 py-3 text-small text-danger-fg" role="status">
            {notFound === 1 ? "1 link is broken or its page isn't on Instagram. It" : `${notFound} links are broken or their pages aren't on Instagram. They`} won&apos;t be imported: fix {notFound === 1 ? "it" : "them"} in the sheet and import again.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="ip-category-all" className="text-small text-muted-foreground">
              Category for all
            </Label>
            <CategorySelect
              id="ip-category-all"
              value={categoryForAll}
              categories={categories}
              keepLabel="Keep the sheet's"
              onChange={(c) => {
                setCategoryForAll(c);
                setCategoryByRow(c === SHEET ? {} : Object.fromEntries(preview.rows.filter((r) => placeable(r) && !isUpdate(r)).map((r) => [r.rowNumber, c])));
              }}
            />
          </div>
          <span className="inline-flex items-center gap-1.5 text-small text-muted-foreground" role="status" aria-live="polite">
            {lookup.isPending ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Looking the pages up on Instagram…
              </>
            ) : liveError ? (
              <span className="text-danger-helper">{liveError}</span>
            ) : Object.keys(live).length ? (
              "Followers are live from Instagram."
            ) : null}
          </span>
          {!lookup.isPending && recheck.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => {
                if (!latest.current) return;
                setLiveError(null);
                lookup.mutate({ handles: recheck, src: latest.current });
              }}
            >
              <RefreshCw />
              Check {plural(recheck.length, "page")} again
            </Button>
          )}
        </div>

        <div className="max-h-96 overflow-auto rounded-card border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Row</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Page</TableHead>
                <TableHead className="text-right">Followers</TableHead>
                {!isCreator && <TableHead className="text-right">Rates</TableHead>}
                <TableHead>Category</TableHead>
                {!isCreator && <TableHead>Creator</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.rows.map((r) => {
                const canPlace = placeable(r);
                const check = canPlace ? checkOf(r) : null;
                const goes = check === "found" || check === "checking";
                const meta = check && check !== "found" ? CHECK[check] : null;
                const update = isUpdate(r);
                const status = meta ?? (update ? STATUS.update : goes ? (isCreator || ownerOf(r) ? STATUS.ready : STATUS["owner-missing"]) : STATUS[r.status]);
                const note = meta?.note ?? (update ? `${changesSummary(r)}${r.replacesPendingEdit ? " · Replaces a suggestion already waiting." : ""}` : goes ? null : r.reason);
                const p = r.handle ? live[r.handle] : undefined;
                const rates = FORMATS.flatMap((f) => r.rateCards.filter((c) => c.format === f));
                const label = displayHandle(r.handle ?? r.rawHandle);
                return (
                  <TableRow key={r.rowNumber} className={goes ? undefined : "text-muted-foreground"}>
                    <TableCell className="num text-muted-foreground">{r.rowNumber}</TableCell>
                    <TableCell className="min-w-44">
                      <StatusPill tone={status.tone}>{status.label}</StatusPill>
                      {note && <span className="mt-1 block text-small text-muted-foreground">{note}</span>}
                    </TableCell>
                    <TableCell className="max-w-48">
                      {r.pageName && <span className="block truncate text-body-strong">{r.pageName}</span>}
                      {(r.grade || r.groupLink) && (
                        <span className="block text-small text-muted-foreground">
                          {r.grade ? `Grade ${r.grade}` : ""}
                          {r.grade && r.groupLink ? " · " : ""}
                          {r.groupLink ? "Group link" : ""}
                        </span>
                      )}
                      {r.handle ? (
                        <a href={`https://www.instagram.com/${r.handle}/`} target="_blank" rel="noreferrer" className="block truncate text-small text-muted-foreground hover:underline">
                          {label}
                        </a>
                      ) : (
                        <span className="block truncate text-small">{r.rawHandle || "—"}</span>
                      )}
                    </TableCell>
                    <TableCell className="num whitespace-nowrap text-right">
                      {p ? (
                        <>
                          {audienceLabel(p.followers, "instagram", true)}
                          {p.avgViews != null && <span className="block text-small text-muted-foreground">{compactNumber(p.avgViews)} avg views</span>}
                        </>
                      ) : p === null ? (
                        "—"
                      ) : r.followers != null ? (
                        audienceLabel(r.followers, "instagram", true)
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    {!isCreator && (
                      <TableCell className="whitespace-nowrap text-right">
                        {rates.length === 0
                          ? "—"
                          : rates.map((c, i) => (
                              <span key={c.format} className={i === 0 ? "block" : "block text-small text-muted-foreground"}>
                                {formatLabel(c.format)} <Money value={c.amount} />
                              </span>
                            ))}
                      </TableCell>
                    )}
                    <TableCell className="min-w-40">
                      {goes && !update ? (
                        <CategorySelect
                          label={`Category for ${label}`}
                          value={categoryByRow[r.rowNumber] ?? SHEET}
                          categories={categories}
                          keepLabel={r.category ? `Sheet: ${r.category}` : "No category"}
                          onChange={(c) =>
                            setCategoryByRow((prev) => {
                              const next = { ...prev };
                              if (c === SHEET) delete next[r.rowNumber];
                              else next[r.rowNumber] = c;
                              return next;
                            })
                          }
                        />
                      ) : (
                        r.category || "—"
                      )}
                    </TableCell>
                    {!isCreator && (
                      <TableCell className="min-w-52">
                        {goes && !update && owners.length > 0 ? (
                          <>
                            <Select value={ownerByRow[r.rowNumber] || DEFAULT} onValueChange={(v) => setOwnerByRow((prev) => ({ ...prev, [r.rowNumber]: v === DEFAULT ? "" : v }))}>
                              <SelectTrigger aria-label={`Creator for ${label}`} className="h-control-sm text-small">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={DEFAULT}>{ownerForAll ? personLabel(owners.find((o) => o.id === ownerForAll)) : "Pick a creator"}</SelectItem>
                                {owners.map((o) => (
                                  <SelectItem key={o.id} value={o.id}>
                                    {ownerOption(o)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {r.status === "owner-unknown" && r.ownerRef && <span className="mt-1 block truncate text-small text-muted-foreground">Sheet said: {r.ownerRef}</span>}
                          </>
                        ) : (
                          personLabel(r.owner)
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {run.isError && (
          <p className="text-small text-danger-helper" role="alert">
            {errText(run.error, "Couldn't import the pages. Try again.")}
          </p>
        )}
        <DialogFooter className="items-center gap-2">
          {waitingForCreator > 0 && <span className="text-small text-muted-foreground sm:mr-auto">{plural(waitingForCreator, "row")} still {waitingForCreator === 1 ? "needs" : "need"} a creator</span>}
          <Button variant="outline" onClick={startOver}>
            Start over
          </Button>
          <Button disabled={toImport.length === 0 || run.isPending || lookup.isPending} onClick={() => run.mutate()}>
            {run.isPending ? "Importing…" : lookup.isPending ? "Checking pages…" : toImport.length ? (creating ? `Import ${plural(creating, "page")}${updating ? ` · update ${updating}` : ""}` : `Update ${plural(updating, "page")}`) : "Nothing to import"}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import pages</DialogTitle>
        <DialogDescription>Add many pages at once from a spreadsheet: one page per row. Each page is looked up on Instagram, and you&apos;ll see every row before anything is added.</DialogDescription>
      </DialogHeader>

      {passwordCard}

      <SegmentedFilter
        label="Import from"
        value={source}
        onChange={(v) => {
          setSource(v);
          setReadError(null);
        }}
        options={[
          { value: "file", label: "Excel or CSV file" },
          { value: "sheet", label: "Google Sheet link" },
        ]}
        className="self-start"
      />

      {source === "file" ? (
        <label
          className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-dropzone-line bg-dropzone px-4 py-6 text-center transition-colors hover:border-brand focus-within:border-brand"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f && !read.isPending) readFile(f);
          }}
        >
          <Upload className="h-6 w-6" aria-hidden />
          <span className="text-body-strong">{read.isPending ? `Reading ${fileName ?? "the file"}…` : "Choose an Excel or CSV file"}</span>
          <span className="text-small text-fg-muted">Or drop it here. The first sheet is used; up to 5 MB.</span>
          <input
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="sr-only"
            disabled={read.isPending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) readFile(f);
            }}
          />
        </label>
      ) : (
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (sheetUrl.trim()) readLink();
          }}
        >
          <Field label="Google Sheet link" description="Share it as “Anyone with the link can view”. The first tab is used." className="flex-1">
            {(a) => <Input {...a} type="url" placeholder="https://docs.google.com/spreadsheets/d/…" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />}
          </Field>
          <Button type="submit" disabled={!sheetUrl.trim() || read.isPending} className="sm:mb-6">
            <FileSpreadsheet />
            {read.isPending ? "Reading…" : "Read rows"}
          </Button>
        </form>
      )}

      {readError && (
        <p className="text-small text-danger-helper" role="alert">
          {readError}
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-card border p-4">
        <h3 className="text-body-strong">Columns</h3>
        <p className="text-small text-muted-foreground">
          <span className="font-semibold text-foreground">Page Link</span> (the page&apos;s Instagram profile link, required), <span className="font-semibold text-foreground">Page Name</span>,{" "}
          {!isCreator && (
            <>
              <span className="font-semibold text-foreground">Vendor Name</span>, <span className="font-semibold text-foreground">Vendor Contact</span> (their email or phone; vendors not in Taggify yet can be added when you check the rows),{" "}
            </>
          )}
          <span className="font-semibold text-foreground">Followers</span>
          {!isCreator ? (
            <>
              , <span className="font-semibold text-foreground">Entertainment / Brand Rate</span>, <span className="font-semibold text-foreground">Reel Rate</span>, <span className="font-semibold text-foreground">Story Rate</span> and the other rate columns in whole rupees. Those three are needed for a new page.
              A page already in Inventory is updated from its row{isAdmin ? "" : " once an admin approves the changes"}.
            </>
          ) : (
            ". A page already in Inventory is updated from its row once an admin approves the changes."
          )}
        </p>
        <Button variant="ghost" size="sm" className="self-start" disabled={template.isPending} onClick={() => template.mutate()}>
          <Download />
          {template.isPending ? "Downloading…" : "Download the template"}
        </Button>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}

function ownerOption(o: PageOwner) {
  const contact = o.email ?? o.phoneNumber;
  return o.name?.trim() && contact ? `${o.name} · ${contact}` : personLabel(o);
}

function CategorySelect({ id, label, value, categories, keepLabel, onChange }: { id?: string; label?: string; value: string; categories: string[]; keepLabel: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={label} className="h-control-sm min-w-40 text-small">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SHEET}>{keepLabel}</SelectItem>
        {categories.map((c) => (
          <SelectItem key={c} value={c}>
            {c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * "Import all pages under": an existing creator, or a new creator login made right
 * here (POST /auth/signup as CREATOR; users.edit, or a planner with inventory.edit).
 */
function CreatorForAll({ owners, value, onChange, hint, onCreated }: { owners: PageOwner[]; value: string; onChange: (id: string) => void; hint: string | null; onCreated: (l: CreatedLogin) => void }) {
  const { user } = useAuth();
  const mayCreate = canCreateLogin(user);
  const [creating, setCreating] = useState(owners.length === 0 && mayCreate);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tried, setTried] = useState(false);
  const validEmail = emailOk(email);
  const createLogin = useCreateCreatorLogin(owners);

  const create = useMutation({
    mutationFn: () => createLogin({ email, name }),
    onSuccess: (l) => {
      onCreated(l);
      setCreating(false);
      setName("");
      setEmail("");
      setTried(false);
    },
  });

  return (
    <div className="flex flex-col gap-3 rounded-card border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="ip-owner-all" className="text-body-strong">
          Import all pages under
        </Label>
        {owners.length > 0 && (
          <Select value={value || DEFAULT} onValueChange={(v) => onChange(v === DEFAULT ? "" : v)}>
            <SelectTrigger id="ip-owner-all" className="h-control-sm w-auto min-w-56 text-small">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>The creator each row names</SelectItem>
              {owners.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {ownerOption(o)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {owners.length === 0 && !mayCreate && <span className="text-small text-muted-foreground">No creator logins yet. Ask an admin to add one in People.</span>}
        {!creating && mayCreate && (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <UserPlus />
            New creator
          </Button>
        )}
      </div>
      {hint && !creating && <p className="text-small text-muted-foreground">{hint}</p>}
      {creating && (
        <form
          className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (validEmail) create.mutate();
          }}
        >
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="ip-new-name">
              Name <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="ip-new-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="ip-new-email">Email (their login)</Label>
            <Input id="ip-new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={tried && !validEmail} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create login"}
            </Button>
            {owners.length > 0 && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            )}
          </div>
          {tried && !validEmail && <p className="text-small text-danger-helper sm:w-full">Enter the new creator&apos;s email. It&apos;s their login.</p>}
          {create.isError && (
            <p className="text-small text-danger-helper sm:w-full" role="alert">
              {errText(create.error, "Couldn't create the login. Try again.")}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

type VendorDraft = { name: string; email: string; phone: string; tried: boolean; status: "open" | "saving" | "created" | "matched" | "skipped"; error: string | null };

const vendorLabel = (v: ImportNewVendor) => v.name?.trim() || v.email || v.phone || `Rows ${v.rowNumbers.join(", ")}`;

/**
 * "New vendors found": vendors the sheet names (Vendor Name / Vendor Contact) that
 * aren't in Taggify. Approving one makes their creator login (email required, phone
 * optional) and puts their rows under it. Without login access it's read-only.
 */
function NewVendorsPanel({ vendors, rows, owners, onAccount }: { vendors: ImportNewVendor[]; rows: ImportPreviewRow[]; owners: PageOwner[]; onAccount: (l: CreatedLogin, rowNumbers: number[]) => void }) {
  const { user } = useAuth();
  const mayCreate = canCreateLogin(user);
  const createLogin = useCreateCreatorLogin(owners);
  const [drafts, setDrafts] = useState<Record<string, VendorDraft>>(() =>
    Object.fromEntries(
      vendors.map((v) => {
        const phone = v.phone ?? "";
        return [v.key, { name: v.name ?? "", email: v.email ?? "", phone: localPhone(phone).length === 10 ? localPhone(phone) : phone, tried: false, status: "open", error: null }];
      }),
    ),
  );
  const [busy, setBusy] = useState(false);
  const patch = (key: string, p: Partial<VendorDraft>) => setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...p } }));
  const handleOf = new Map(rows.map((r) => [r.rowNumber, displayHandle(r.handle ?? r.rawHandle)]));
  const open = vendors.filter((v) => drafts[v.key]?.status === "open" || drafts[v.key]?.status === "saving");

  async function approve(list: ImportNewVendor[]) {
    list.forEach((v) => patch(v.key, { tried: true }));
    const ok = list.filter((v) => drafts[v.key].status === "open" && emailOk(drafts[v.key].email) && phoneOk(drafts[v.key].phone));
    if (!ok.length) return;
    setBusy(true);
    // One at a time: each signup is its own request, and a failure only stops that vendor.
    for (const v of ok) {
      const d = drafts[v.key];
      patch(v.key, { status: "saving", error: null });
      try {
        const login = await createLogin({ email: d.email, name: d.name, phone: d.phone });
        onAccount(login, v.rowNumbers);
        patch(v.key, { status: login.matched ? "matched" : "created" });
      } catch (e) {
        patch(v.key, { status: "open", error: errText(e, "Couldn't create the login. Try again.") });
      }
    }
    setBusy(false);
  }

  return (
    <section aria-label="New vendors" className="flex flex-col gap-3 rounded-card border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-body-strong">New vendors found ({vendors.length})</h3>
        {mayCreate && open.length > 1 && (
          <Button size="sm" className="ml-auto" disabled={busy} onClick={() => approve(open)}>
            <UserPlus />
            Approve all
          </Button>
        )}
      </div>
      <p className="text-small text-muted-foreground">
        {mayCreate
          ? "The sheet names vendors who aren't in Taggify yet. Check their details and approve to create their creator login; their pages go under it. Email is their login."
          : "The sheet names vendors who aren't in Taggify yet. Ask an admin to add these vendors, or pick an existing creator below."}
      </p>
      <ul className="flex flex-col divide-y rounded-card border">
        {vendors.map((v) => {
          const d = drafts[v.key];
          const label = vendorLabel(v);
          const handles = v.rowNumbers.map((n) => handleOf.get(n) ?? `Row ${n}`);
          const pages = (
            <details className="text-small text-muted-foreground">
              <summary className="cursor-pointer" title={handles.join(", ")}>
                {plural(v.rowNumbers.length, "page")}
              </summary>
              <span className="mt-1 block">{handles.join(", ")}</span>
            </details>
          );
          const editable = mayCreate && (d.status === "open" || d.status === "saving");
          return (
            <li key={v.key} aria-label={label} className="flex flex-col gap-3 px-4 py-3">
              {editable ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Name (optional)">{(a) => <Input {...a} value={d.name} onChange={(e) => patch(v.key, { name: e.target.value })} />}</Field>
                    <Field label="Email (their login)" error={d.tried && !emailOk(d.email) ? "Enter their email. It's their login." : null}>
                      {(a) => <Input {...a} type="email" value={d.email} onChange={(e) => patch(v.key, { email: e.target.value })} />}
                    </Field>
                    <Field label="Mobile (optional)" description="10 digits. We add +91." error={d.tried && !phoneOk(d.phone) ? "Enter a 10-digit mobile number, or leave it empty." : null}>
                      {(a) => <Input {...a} inputMode="tel" value={d.phone} onChange={(e) => patch(v.key, { phone: e.target.value })} />}
                    </Field>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="mr-auto">{pages}</div>
                    {/* Locked while Approve all runs: it already took this vendor in, so skipping now wouldn't stop it. */}
                    <Button size="sm" variant="ghost" disabled={busy || d.status === "saving"} onClick={() => patch(v.key, { status: "skipped", error: null })}>
                      Not now
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => approve([v])}>
                      {d.status === "saving" ? "Creating…" : "Approve & create"}
                    </Button>
                  </div>
                  {d.error && (
                    <p className="text-small text-danger-helper" role="alert">
                      {d.error}
                    </p>
                  )}
                </>
              ) : (
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <div className="mr-auto min-w-0">
                    <span className="block text-body-strong">{(mayCreate ? d.name.trim() : v.name?.trim()) || label}</span>
                    <span className="block text-small text-muted-foreground">{[mayCreate ? d.email.trim() : v.email, mayCreate ? d.phone.trim() : v.phone].filter(Boolean).join(" · ") || "No contact in the sheet"}</span>
                    {pages}
                  </div>
                  {d.status === "created" && (
                    <StatusPill tone="success">
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      Created
                    </StatusPill>
                  )}
                  {d.status === "matched" && <StatusPill tone="neutral">Matched to existing account</StatusPill>}
                  {d.status === "skipped" && (
                    <span className="flex items-center gap-2 text-small text-muted-foreground">
                      Skipped. Pick a creator for these pages below.
                      <Button size="sm" variant="ghost" onClick={() => patch(v.key, { status: "open", tried: false })}>
                        Undo
                      </Button>
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A new login's one-time password stays up until the dialog closes. */
function PasswordCard({ login }: { login: NewLogin }) {
  const [copied, setCopied] = useState(false);
  const email = login.owner.email ?? "";
  return (
    <div className="flex flex-col gap-2 rounded-card bg-success-soft p-4 text-success-fg">
      <p className="text-small">
        <span className="font-semibold">Login created for {personLabel(login.owner)}.</span> Share the password now. It won&apos;t be shown again.
      </p>
      {email && login.owner.name?.trim() && <p className="text-small">Email: {email}</p>}
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border bg-card px-3 py-2 font-mono text-body-strong" data-testid="generated-password">
          {login.password}
        </code>
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`Email: ${email}\nPassword: ${login.password}`);
              setCopied(true);
            } catch {
              toast.error("Couldn't copy. Select the password and copy it by hand.");
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy login"}
        </Button>
      </div>
    </div>
  );
}

function ResultView({ result, isAdmin, passwordCard, onClose }: { result: ImportResult; isAdmin: boolean; passwordCard: ReactNode; onClose: () => void }) {
  const byOwner = new Map<string, { owner: ImportResult["created"][number]["owner"]; handles: string[] }>();
  for (const a of result.created) {
    const entry = byOwner.get(a.owner.id) ?? { owner: a.owner, handles: [] };
    entry.handles.push(a.handle);
    byOwner.set(a.owner.id, entry);
  }
  const updated = result.updated ?? [];
  const proposed = result.proposed ?? [];
  const headline = [result.created.length ? `${plural(result.created.length, "page")} imported` : "", updated.length ? `${updated.length} updated` : "", proposed.length ? `${proposed.length} sent for approval` : ""].filter(Boolean).join(" · ");
  return (
    <>
      <DialogHeader>
        <DialogTitle>{headline || "Nothing was imported"}</DialogTitle>
        <DialogDescription>
          {result.created.length > 0 && (isAdmin ? "New pages are approved and live in Inventory. " : "New pages are waiting for an admin's approval. ")}
          {updated.length > 0 && "Updated pages changed straight away. "}
          {proposed.length > 0 && "Suggested changes wait for an admin to apply them. "}
          {result.skipped.length > 0 ? `${plural(result.skipped.length, "page")} skipped: see why below.` : result.created.length ? "Profile pictures are saved in the background." : ""}
        </DialogDescription>
      </DialogHeader>
      {passwordCard}
      {(updated.length > 0 || proposed.length > 0) && (
        <ul aria-label="Updated pages" className="flex flex-col divide-y rounded-card border">
          {updated.length > 0 && (
            <li className="px-4 py-2">
              <span className="block text-body-strong">Updated</span>
              <span className="block text-small text-muted-foreground">{updated.map((u) => displayHandle(u.handle)).join(", ")}</span>
            </li>
          )}
          {proposed.length > 0 && (
            <li className="px-4 py-2">
              <span className="block text-body-strong">Sent for approval</span>
              <span className="block text-small text-muted-foreground">{proposed.map((u) => displayHandle(u.handle)).join(", ")}</span>
            </li>
          )}
        </ul>
      )}
      {byOwner.size > 0 && (
        <ul className="flex flex-col divide-y rounded-card border">
          {[...byOwner.values()].map(({ owner, handles }) => (
            <li key={owner.id} className="px-4 py-2">
              <span className="block text-body-strong">
                {personLabel(owner)} <span className="font-normal text-muted-foreground">· {plural(handles.length, "page")}</span>
              </span>
              <span className="block text-small text-muted-foreground">{handles.map((h) => displayHandle(h)).join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
      {result.skipped.length > 0 && (
        <ol aria-label="Skipped pages" className="max-h-72 divide-y overflow-auto rounded-card border">
          {result.skipped.map((s, i) => (
            <li key={`${s.handle}-${i}`} className="px-4 py-2">
              <span className="block truncate text-body-strong">{displayHandle(s.handle)}</span>
              <span className="block text-small text-muted-foreground">{s.reason}</span>
            </li>
          ))}
        </ol>
      )}
      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
}
