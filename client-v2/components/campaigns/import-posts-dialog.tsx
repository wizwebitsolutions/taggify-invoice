"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Upload } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, campaigns as campaignsApi, hasAccess, links as linksApi } from "@/lib/api-client";
import { formatLabel } from "@/lib/finance";
import { plural } from "@/lib/format";
import { useCampaigns, invalidateAfterPostChange } from "@/lib/queries/campaigns";
import { useAllPages } from "@/lib/queries/creators";
import { parseWorkSheet, WORK_IMPORT_MAX, WORK_SHEET_TEMPLATE, type WorkSheetRow } from "@/lib/sheet-import";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field } from "@/components/taggify/field";
import { Money } from "@/components/taggify/money";
import { SegmentedFilter } from "@/components/taggify/segmented-filter";
import { StatusPill } from "@/components/taggify/status-pill";
import { displayHandle } from "@/components/finance/identity";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

type Checked = WorkSheetRow & { status: "ready" | "check" | "blocked"; note: string | null };
type Result = { created: number; skipped: { line: number | null; label: string; reason: string }[] };

/**
 * "Import posts" on Content (POST /links/bulk-import, links.edit): posts that
 * already went out, one row each. Three steps: pick a CSV or a Google Sheet
 * link → preview every row with what will happen to it → import the rows
 * that can go and show what the server skipped and why.
 */
export function ImportPostsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-3xl">{open && <ImportFlow onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function ImportFlow({ onClose }: { onClose: () => void }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const campaigns = useCampaigns();
  const pages = useAllPages();
  // Fetching a Google Sheet goes through POST /campaigns/import-sheet-url (campaigns.edit).
  const canUseSheetLink = hasAccess(user, "campaigns.edit");
  // The server only takes a custom cost from an admin (links service createOneLink); anyone else gets the rate card.
  const costAllowed = user?.role === "ADMIN";
  // The preview's page and campaign checks need both lists; Import waits for them.
  const listsLoading = pages.isLoading || campaigns.isLoading;
  const [source, setSource] = useState<"file" | "sheet">("file");
  const [sheetUrl, setSheetUrl] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<WorkSheetRow[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const read = useMutation({
    mutationFn: async (input: File | string) => parseWorkSheet(typeof input === "string" ? (await campaignsApi.importSheetUrl(accessToken!, input)).csv : input),
    onSuccess: (parsed) => {
      if (parsed.length === 0) return setReadError("No rows found. The first row should be the column names, with one post per row under it.");
      if (parsed.length > WORK_IMPORT_MAX) return setReadError(`That's ${parsed.length} rows. Import up to ${WORK_IMPORT_MAX} at a time: split the sheet and import each part.`);
      setReadError(null);
      setRows(parsed);
    },
    onError: (e) => setReadError(errText(e, "Couldn't read that. Check it's a CSV or a shared Google Sheet link.")),
  });

  // What will happen to each row. Pages are checked here (we have the full list); campaign names
  // are only a hint, because a later phase can carry its own name that the campaign list doesn't show.
  const checked: Checked[] = useMemo(() => {
    if (!rows) return [];
    const handles = pages.data ? new Set(pages.data.map((p) => p.handle.toLowerCase())) : null;
    const titles = new Set((campaigns.data ?? []).map((c) => c.title.toLowerCase()));
    return rows.map((r) => {
      if (r.problem) return { ...r, status: "blocked", note: r.problem };
      if (handles && !handles.has(r.pageHandle.toLowerCase())) return { ...r, status: "blocked", note: `No page called ${displayHandle(r.pageHandle)} in Inventory` };
      const title = r.campaignTitle.toLowerCase();
      const base = title.replace(/\s+—\s+phase\s+\d+$/, "");
      if (campaigns.data && !titles.has(base)) return { ...r, status: "check", note: "Campaign name not found. It's checked again on import" };
      // The campaign list only has phase 1 names; whether this phase exists is checked on import.
      if (base !== title) return { ...r, status: "check", note: "Phase name is checked on import" };
      return { ...r, status: "ready", note: null };
    });
  }, [rows, pages.data, campaigns.data]);
  const sendable = checked.filter((r) => r.status !== "blocked");
  const blocked = checked.length - sendable.length;

  const run = useMutation({
    mutationFn: () => linksApi.bulkImport(accessToken!, sendable.map(({ campaignTitle, pageHandle, url, format, cost }) => ({ campaignTitle, pageHandle, url, format, ...(cost && costAllowed ? { cost } : {}) }))),
    onSuccess: async (r) => {
      const lineOf = (row: unknown) => {
        const x = row as { url?: string; pageHandle?: string };
        return sendable.find((s) => s.url === x.url && s.pageHandle === x.pageHandle)?.line ?? null;
      };
      setResult({
        created: r.created.length,
        skipped: [
          ...checked.filter((c) => c.status === "blocked").map((c) => ({ line: c.line, label: rowLabel(c), reason: c.note! })),
          ...r.skipped.map((s) => ({ line: lineOf(s.row), label: rowLabel(s.row as WorkSheetRow), reason: plainReason(s.reason) })),
        ].sort((a, b) => (a.line ?? 0) - (b.line ?? 0)),
      });
      if (r.created.length) {
        await invalidateAfterPostChange(qc);
        toast.success(`${plural(r.created.length, "post")} imported.`);
      }
    },
  });

  if (result) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{result.created ? `${plural(result.created, "post")} imported` : "Nothing was imported"}</DialogTitle>
          <DialogDescription>
            {result.skipped.length === 0
              ? "Every row went in. The posts are in Content and on their campaigns now."
              : `${plural(result.skipped.length, "row")} skipped. Fix ${result.skipped.length === 1 ? "it" : "them"} in the sheet and import just ${result.skipped.length === 1 ? "that row" : "those rows"} again.`}
          </DialogDescription>
        </DialogHeader>
        {result.skipped.length > 0 && <SkippedList items={result.skipped} />}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </>
    );
  }

  if (rows) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Check the rows</DialogTitle>
          <DialogDescription>
            {fileName ?? "Google Sheet"}: {plural(rows.length, "row")}. {sendable.length === rows.length ? "All of them can be imported." : `${plural(sendable.length, "row")} can be imported; ${plural(blocked, "row")} can't and will be left out.`}
            {!costAllowed && rows.some((r) => r.cost) ? " Costs in the sheet aren't used: only an admin can set a cost, so each post gets its page's rate card." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-96 overflow-auto rounded-card border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Row</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Page</TableHead>
                <TableHead>Post</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checked.map((r) => (
                <TableRow key={r.line}>
                  <TableCell className="num text-muted-foreground">{r.line}</TableCell>
                  {/* Status first: it's what this screen is for, and it stays visible when the table scrolls sideways. */}
                  <TableCell className="min-w-56">
                    <StatusPill tone={r.status === "ready" ? "success" : r.status === "check" ? "warning" : "danger"}>{r.status === "ready" ? "Ready" : r.status === "check" ? "Check" : "Can't import"}</StatusPill>
                    {r.note && <span className="mt-1 block text-small text-muted-foreground">{r.note}</span>}
                  </TableCell>
                  <TableCell className="max-w-40 truncate">{r.campaignTitle || "—"}</TableCell>
                  <TableCell className="max-w-32 truncate">{r.pageHandle ? displayHandle(r.pageHandle) : "—"}</TableCell>
                  <TableCell className="max-w-40">
                    <span className="block truncate">{r.url ? r.url.replace(/^https?:\/\/(www\.)?/, "") : "—"}</span>
                    <span className="block text-small text-muted-foreground">{r.format ? formatLabel(r.format) : ""}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">{r.cost && costAllowed ? <Money value={r.cost} /> : <span className="text-small text-muted-foreground">Rate card</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {run.isError && (
          <p className="text-small text-danger-helper" role="alert">
            {errText(run.error, "Couldn't finish the import. Try again: rows that already went in are skipped, not added twice.")}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setRows(null);
              setFileName(null);
              run.reset();
            }}
          >
            Start over
          </Button>
          <Button disabled={sendable.length === 0 || run.isPending || listsLoading} onClick={() => run.mutate()}>
            {run.isPending ? "Importing…" : listsLoading ? "Checking rows…" : sendable.length ? `Import ${plural(sendable.length, "post")}` : "Nothing to import"}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import posts</DialogTitle>
        <DialogDescription>Add posts that already went out, from a spreadsheet: one row per post. You&apos;ll see every row before anything is imported.</DialogDescription>
      </DialogHeader>

      {canUseSheetLink && (
        <SegmentedFilter
          label="Import from"
          value={source}
          onChange={(v) => {
            setSource(v);
            setReadError(null);
          }}
          options={[
            { value: "file", label: "CSV file" },
            { value: "sheet", label: "Google Sheet link" },
          ]}
          className="self-start"
        />
      )}

      {source === "file" ? (
        <label
          className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-dropzone-line bg-dropzone px-4 py-6 text-center transition-colors hover:border-brand focus-within:border-brand"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) {
              setFileName(f.name);
              read.mutate(f);
            }
          }}
        >
          <Upload className="h-6 w-6" aria-hidden />
          <span className="text-body-strong">{read.isPending ? "Reading…" : "Choose a CSV file"}</span>
          <span className="text-small text-fg-muted">Or drop it here. In Excel or Google Sheets: File → Download → CSV.</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={read.isPending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) {
                setFileName(f.name);
                read.mutate(f);
              }
            }}
          />
        </label>
      ) : (
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (sheetUrl.trim()) {
              setFileName(null);
              read.mutate(sheetUrl.trim());
            }
          }}
        >
          <Field label="Google Sheet link" description="Share it as “Anyone with the link can view”." className="flex-1">
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
          <span className="font-semibold text-foreground">Campaign</span> (its name), <span className="font-semibold text-foreground">Page</span> (Instagram handle), <span className="font-semibold text-foreground">Post URL</span>,{" "}
          <span className="font-semibold text-foreground">Format</span> (Reel, Story, Static / Carousel or Political reel; a Reel + Story booking is one row per post)
          {costAllowed ? (
            <>
              {" "}
              and, if it differs from the page&apos;s rate card, <span className="font-semibold text-foreground">Cost</span> in whole rupees.
            </>
          ) : (
            ". Each post is billed at its page's rate card."
          )}
        </p>
        <Button asChild variant="ghost" size="sm" className="self-start">
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(WORK_SHEET_TEMPLATE)}`} download="import-posts-sample.csv">
            <Download />
            Download a sample CSV
          </a>
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

/** The server's skip reasons, in the app's words (handles without "@", "page" not "asset"). */
function plainReason(reason: string) {
  const noPage = reason.match(/^No page @?(\S+)$/);
  if (noPage) return `No page called ${noPage[1]} in Inventory`;
  const noRate = reason.match(/^No rate card set for format "(\w+)"/);
  if (noRate) return `This page has no ${noRate[1]} rate card, and the row has no cost`;
  if (reason === "Already submitted for this page") return "Already in Content for this page";
  return reason;
}

function rowLabel(r: Pick<WorkSheetRow, "pageHandle" | "campaignTitle">) {
  return [r.pageHandle ? displayHandle(r.pageHandle) : null, r.campaignTitle || null].filter(Boolean).join(" · ") || "Empty row";
}

function SkippedList({ items }: { items: Result["skipped"] }) {
  return (
    <ol className="max-h-72 divide-y overflow-auto rounded-card border">
      {items.map((s, i) => (
        <li key={`${s.line}-${i}`} className="flex gap-3 px-4 py-2">
          <span className="num w-14 shrink-0 text-small text-muted-foreground">{s.line ? `Row ${s.line}` : "—"}</span>
          <span className="min-w-0">
            <span className="block truncate text-body-strong">{s.label}</span>
            <span className="block text-small text-muted-foreground">{s.reason}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
