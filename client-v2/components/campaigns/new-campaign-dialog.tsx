"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, FileSpreadsheet, Upload } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, campaigns as campaignsApi } from "@/lib/api-client";
import { BOOKABLE_FORMATS, COMBO_ROW_MESSAGE, formatFromText, isBookableFormat, isCombo, joinLabels } from "@/lib/formats";
import { formatLabel } from "@/lib/finance";
import { plural } from "@/lib/format";
import { HANDLE_HEADERS, handleFromInstagramUrl, readText, type CsvSource } from "@/lib/sheet-import";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field } from "@/components/taggify/field";
import { Money } from "@/components/taggify/money";
import { SegmentedFilter } from "@/components/taggify/segmented-filter";
import { displayHandle } from "@/components/finance/identity";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

const STEPS = [
  { label: "Basics", hint: "What is this deal?" },
  { label: "Budget & phase", hint: "How much, and by when?" },
  { label: "Pages", hint: "Which pages will post?" },
  { label: "Review", hint: "Check everything before creating." },
];
/** Server cap per campaign (createCampaignSchema assignments.max). */
const MAX_ROWS = 500;
const PREVIEW_ROWS = 8;

/**
 * "New campaign" on Campaigns (POST /campaigns, campaigns.edit). Same four
 * steps as v1: brand and title → budget cap and deadline → pages from a CSV or
 * a Google Sheet link, with a preview → review, with a warning when the
 * sheet's costs go over the cap. Opens on its own from /campaigns?new=1.
 */
export function NewCampaignDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (campaignId: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-2xl" data-testid="new-campaign-dialog">
        {open && <NewCampaignFlow onClose={() => onOpenChange(false)} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  );
}

function NewCampaignFlow({ onClose, onCreated }: { onClose: () => void; onCreated: (campaignId: string) => void }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [brandName, setBrandName] = useState("");
  const [title, setTitle] = useState("");
  const [costCap, setCostCap] = useState("");
  const [deadline, setDeadline] = useState("");
  const [source, setSource] = useState<"file" | "sheet">("sheet");
  const [sheetLink, setSheetLink] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [readError, setReadError] = useState<string | null>(null);

  const read = useMutation({
    mutationFn: async (input: File | string) => parseAssignmentSheet(typeof input === "string" ? (await campaignsApi.importSheetUrl(accessToken!, input)).csv : input),
    onSuccess: (parsed) => {
      if (parsed.length === 0) {
        setRows([]);
        return setReadError("No rows found. The first row should be the column names (e.g. Handle, Phone), with one page per row under it.");
      }
      if (parsed.length > MAX_ROWS) {
        setRows([]);
        return setReadError(`That's ${parsed.length} rows. A campaign takes up to ${MAX_ROWS} pages from a sheet.`);
      }
      setReadError(null);
      setRows(parsed);
    },
    onError: (e) => {
      setRows([]);
      setReadError(errText(e, "Couldn't read that. Check it's a CSV or a shared Google Sheet link."));
    },
  });

  const cap = costCap ? Number(costCap) : null;
  const link = sheetLink.trim();
  const linkOk = !link || isWebAddress(link);

  const create = useMutation({
    mutationFn: () =>
      campaignsApi.create(accessToken!, {
        brandName: brandName.trim(),
        title: title.trim(),
        deadline: deadline || undefined,
        costCap: cap ?? undefined,
        sheetLink: link || undefined,
        assignments: rows.length > 0 ? rows : undefined,
      }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success(r.pendingCount > 0 ? `Campaign created. ${plural(r.pendingCount, "page")} from the sheet ${r.pendingCount === 1 ? "isn't" : "aren't"} in Inventory yet: add or match ${r.pendingCount === 1 ? "it" : "them"} on the campaign.` : "Campaign created.");
      onCreated(r.campaign.id);
    },
  });

  const basicsOk = brandName.trim().length > 0 && title.trim().length > 0;
  const canNext = [basicsOk, true, linkOk && !read.isPending, basicsOk && linkOk][step];
  const rowCost = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
  const withPosts = rows.filter((r) => r.postUrl).length;

  function next() {
    if (!canNext) return;
    // Enter in the sheet link field reads the sheet first, so its rows are what gets sent.
    if (step === 2 && source === "sheet" && link && rows.length === 0 && !readError) return read.mutate(link);
    if (step < 3) return setStep(step + 1);
    create.reset();
    create.mutate();
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        next();
      }}
    >
      <DialogHeader>
        <DialogTitle>New campaign</DialogTitle>
        <DialogDescription>
          Step {step + 1} of 4 · {STEPS[step].hint}
        </DialogDescription>
      </DialogHeader>

      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li
            key={s.label}
            aria-current={i === step ? "step" : undefined}
            className={cn("flex items-center gap-2 rounded-pill border bg-card py-1 pl-1 pr-3 text-small font-medium text-fg-muted", i === step && "border-brand-200 text-brand-ink", i < step && "text-foreground")}
          >
            <span className={cn("grid h-6 w-6 place-items-center rounded-full bg-muted text-micro font-bold", i === step && "bg-brand text-brand-foreground", i < step && "bg-step-done text-brand-ink")}>{i < step ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="flex flex-col gap-4">
          <Field label="Brand name">{(a) => <Input {...a} autoFocus maxLength={100} placeholder="e.g. Zomato" value={brandName} onChange={(e) => setBrandName(e.target.value)} />}</Field>
          <Field label="Campaign title">{(a) => <Input {...a} maxLength={150} placeholder="e.g. Zomato Diwali" value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <Field label="Budget cap (optional)" description="In whole rupees. Spend on the campaign is tracked against it.">
            {(a) => <Input {...a} autoFocus inputMode="numeric" placeholder="e.g. 720000" value={costCap} onChange={(e) => setCostCap(e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 12))} />}
          </Field>
          <Field label="Deadline (optional)">{(a) => <Input {...a} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />}</Field>
          <p className="rounded-card bg-info-soft px-4 py-3 text-small text-info-fg">This creates phase 1. Add phase 2 later from the campaign page when a second batch of posts is needed under the same deal.</p>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <p className="text-small text-muted-foreground">
            Optional. A sheet with one page per row: <span className="font-semibold text-foreground">Handle</span>, and if you have them, <span className="font-semibold text-foreground">Phone</span>, <span className="font-semibold text-foreground">Post URL</span>,{" "}
            <span className="font-semibold text-foreground">Format</span> ({joinLabels(BOOKABLE_FORMATS, "or")}) and <span className="font-semibold text-foreground">Cost</span>. Handles are matched against Inventory, and a sheet link is kept on the campaign.
          </p>
          <SegmentedFilter
            label="Pages from"
            value={source}
            onChange={(v) => {
              setSource(v);
              // Rows read from the other source would no longer match what's on screen.
              setRows([]);
              setFileName(null);
              setReadError(null);
            }}
            options={[
              { value: "sheet", label: "Google Sheet link" },
              { value: "file", label: "CSV file" },
            ]}
            className="self-start"
          />
          {source === "sheet" ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="Google Sheet link" description="Share it as “Anyone with the link can view”." error={linkOk ? null : "Paste the full link, starting with https://"} className="flex-1">
                {(a) => <Input {...a} type="url" placeholder="https://docs.google.com/spreadsheets/d/…" value={sheetLink}
                    onChange={(e) => {
                      setSheetLink(e.target.value);
                      // A changed link needs reading again; never send one sheet's rows with another's link.
                      setRows([]);
                      setReadError(null);
                    }}
                  />}
              </Field>
              <Button
                type="button"
                variant="outline"
                className="sm:mb-6"
                disabled={!link || !linkOk || read.isPending}
                onClick={() => {
                  setFileName(null);
                  read.mutate(link);
                }}
              >
                <FileSpreadsheet />
                {read.isPending ? "Reading…" : "Read rows"}
              </Button>
            </div>
          ) : (
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
              <span className="text-body-strong">{read.isPending ? "Reading…" : fileName ?? "Choose a CSV file"}</span>
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
          )}

          {readError && (
            <p className="text-small text-danger-helper" role="alert">
              {readError}
            </p>
          )}

          {rows.length > 0 && (
            <>
              <p className="text-small text-muted-foreground">
                {plural(rows.length, "row")} read{fileName ? ` from ${fileName}` : ""}.
                {withPosts > 0 && ` ${withPosts} of them name a post: it's added to the page's posts straight away.`}
              </p>
              <div className="overflow-auto rounded-card border" data-testid="sheet-preview">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Page</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="max-w-48 truncate text-body-strong">{displayHandle(r.handle)}</TableCell>
                        <TableCell className="text-muted-foreground">{r.phone || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{r.format ? formatLabel(r.format) : "—"}</TableCell>
                        <TableCell className="text-right">{r.cost ? <Money value={r.cost} /> : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rows.length > PREVIEW_ROWS && <p className="border-t px-4 py-2 text-small text-muted-foreground">and {plural(rows.length - PREVIEW_ROWS, "more row")}</p>}
              </div>
              <p className="rounded-card bg-muted px-4 py-3 text-small text-muted-foreground">Pages that aren&apos;t in Inventory yet stay on the campaign as &quot;not in Inventory&quot; until you add or match them there.</p>
            </>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-card border p-4 text-body" data-testid="new-campaign-review">
            <dt className="text-muted-foreground">Brand</dt>
            <dd className="truncate text-right font-semibold">{brandName.trim()}</dd>
            <dt className="text-muted-foreground">Title</dt>
            <dd className="truncate text-right font-semibold">{title.trim()}</dd>
            <dt className="text-muted-foreground">Budget cap</dt>
            <dd className="text-right font-semibold">{cap ? <Money value={cap} /> : "No cap"}</dd>
            <dt className="text-muted-foreground">Deadline</dt>
            <dd className="text-right font-semibold">{deadline ? new Date(`${deadline}T00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "None"}</dd>
            <dt className="text-muted-foreground">Pages</dt>
            <dd className="text-right font-semibold">
              {rows.length > 0 ? (
                <>
                  {plural(rows.length, "page")} from the sheet
                  {rowCost > 0 && (
                    <>
                      {" · "}
                      <Money value={rowCost} />
                    </>
                  )}
                </>
              ) : (
                "Add later"
              )}
            </dd>
          </dl>
          {cap && rowCost > cap ? (
            <p className="rounded-card bg-warning-soft px-4 py-3 text-small text-warning-fg" role="status">
              The sheet&apos;s costs (<Money value={rowCost} />) are above the budget cap (<Money value={cap} />). You can still create it, or go back and change the cap.
            </p>
          ) : null}
        </div>
      )}

      {create.isError && (
        <p className="text-small text-danger-helper" role="alert">
          {errText(create.error, "Couldn't create the campaign. Try again.")}
        </p>
      )}

      <DialogFooter className="gap-2">
        {step > 0 ? (
          <Button type="button" variant="ghost" className="sm:mr-auto" disabled={create.isPending} onClick={() => setStep(step - 1)}>
            <ArrowLeft />
            Back
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!canNext || create.isPending}>
          {step < 3 ? (
            <>
              {step === 2 ? "Continue to review" : "Continue"}
              <ArrowRight />
            </>
          ) : create.isPending ? (
            "Creating…"
          ) : (
            "Create campaign"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Sheet of pages ──────────────────────────────────────────────────

/** One sheet row as POST /campaigns takes it (campaignAssignmentRowSchema). */
type AssignmentRow = { handle: string; phone?: string; postUrl?: string; format?: string; cost?: number };

const PHONE_HEADERS = ["phone", "phone number", "creator phone", "creator", "owner"];
const URL_HEADERS = ["url", "link", "post url", "post link"];
const FORMAT_HEADERS = ["format", "type", "post type"];
const COST_HEADERS = ["cost", "amount", "rate", "price", "finance"];

/**
 * Same columns as v1 (client/lib/parseAssignmentSheet.ts parseAssignmentSheet):
 * a handle (or the first column), optional phone, and optionally a post that
 * already went out (URL + format + cost). A post URL is only kept with a
 * format the app takes, and cost only with a post, so no row can make the
 * server refuse the whole campaign.
 */
async function parseAssignmentSheet(source: CsvSource): Promise<AssignmentRow[]> {
  const text = await readText(source);
  const { data } = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const rows: AssignmentRow[] = [];
  for (const row of data) {
    const keys = Object.keys(row);
    const find = (headers: string[]) => keys.find((k) => headers.includes(k.trim().toLowerCase()));
    const get = (key: string | undefined) => (key ? (row[key] ?? "").trim() : "");
    const rawHandle = get(find(HANDLE_HEADERS) ?? keys[0]);
    // Handles are stored without the "@"; a pasted profile link counts as its handle.
    const handle = handleFromInstagramUrl(rawHandle) ?? rawHandle.replace(/^@+/, "");
    if (!handle || handle.length > 60) continue;
    const phone = get(find(PHONE_HEADERS));
    const url = get(find(URL_HEADERS));
    const rawFormat = get(find(FORMAT_HEADERS)).toLowerCase();
    const format = formatFromText(rawFormat) ?? rawFormat;
    // A combo is booked on a plan; in a sheet each of its two posts needs its own row (the server refuses the campaign otherwise).
    if (isCombo(format)) throw new Error(`${handle}: ${COMBO_ROW_MESSAGE}.`);
    const withPost = isWebAddress(url) && url.length <= 500 && isBookableFormat(format);
    // Whole rupees only ("₹18,000", "18000.00", "Rs 18000"), so no float ever reaches the money column.
    const costDigits = get(find(COST_HEADERS))
      .replace(/₹|rs\.?|inr|,|\s/gi, "")
      .replace(/\.0+$/, "");
    const cost = /^\d{1,10}$/.test(costDigits) ? Number(costDigits) : undefined;
    rows.push({
      handle,
      phone: phone && phone.length <= 20 ? phone : undefined,
      postUrl: withPost ? url : undefined,
      format: withPost ? format : undefined,
      cost: withPost && cost ? cost : undefined,
    });
  }
  return rows;
}

function isWebAddress(value: string) {
  if (!value || /\s/.test(value)) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
