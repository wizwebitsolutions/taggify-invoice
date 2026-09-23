"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField, FieldError } from "@/components/ui/form-field";
import { ErrorNotice } from "@/components/ui/table-parts";
import { DownloadIcon } from "@/components/icons";
import { plans as plansApi, ApiError, type Plan } from "@/lib/api-client";
import { parsePlanSheet, PLAN_SHEET_TEMPLATE_DETAILS, PLAN_SHEET_TEMPLATE_PAGES, type ParsedPlanSheet } from "@/lib/parseAssignmentSheet";
import { money } from "@/lib/format";
import { rowsToCsv } from "@/components/plans/execution-sheet-modal";

/**
 * Plans → "Upload plan" (user request, 22 Sep — "plan maker can upload
 * their own made excel sheet plan ... on clicking pop up of attaching
 * google sheets"). Paste a Google Sheet link → fetch + parse it here (same
 * /import-sheet-url leg as the wizard, parsePlanSheet for the layout) →
 * a review of what was found → Create. Name and client name are the only
 * two the sheet must supply (or the user types them here); everything else
 * missing is listed and collected afterwards, in steps, on the card
 * (CompletePlanSteps) — `onCreated` hands the new plan back so the parent
 * can open those steps straight away.
 *
 * The link is stored on the plan, so Refresh on the card re-fetches this
 * same sheet — nobody re-attaches it.
 */
export function UploadPlanModal({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: (plan: Plan) => void }) {
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [parsed, setParsed] = useState<ParsedPlanSheet | null>(null);
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");

  const trimmed = url.trim();
  const urlError = !trimmed
    ? "Paste the sheet's link."
    : !/^https:\/\/docs\.google\.com\/spreadsheets\//i.test(trimmed)
    ? "Only Google Sheets links are supported — https://docs.google.com/spreadsheets/…"
    : trimmed.length > 500
    ? "That link is too long (500 characters max)."
    : null;

  const fetchMutation = useMutation({
    mutationFn: async (link: string) => {
      const { tabs } = await plansApi.importSheetTabs(token, link);
      return parsePlanSheet(tabs.map((t) => t.csv));
    },
    onSuccess: (result) => {
      setParsed(result);
      setName(result.fields.name ?? "");
      setClientName(result.fields.clientName ?? "");
      setTouched(false);
    },
  });
  const createMutation = useMutation({
    mutationFn: () =>
      plansApi.createFromSheet(token, {
        sourceSheetUrl: trimmed,
        fields: { ...parsed!.fields, name: name.trim(), clientName: clientName.trim() },
        rows: parsed!.rows,
      }),
    onSuccess: (plan) => onCreated(plan),
  });

  const nameError = name.trim() ? null : "Plan name is required.";
  const clientError = clientName.trim() ? null : "Client name is required.";
  const empty = parsed && parsed.rows.length === 0 && Object.keys(parsed.fields).length === 0;

  // One .csv per tab — a CSV can't hold two tabs, so the template comes as
  // the Details tab and the Pages tab to import into a sheet one each.
  const downloadTemplate = (tab: "details" | "pages") => {
    const rows = tab === "details" ? PLAN_SHEET_TEMPLATE_DETAILS : PLAN_SHEET_TEMPLATE_PAGES;
    const href = URL.createObjectURL(new Blob(["﻿", rowsToCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = `taggify-plan-template-${tab}.csv`;
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[600px]">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6 pt-1" data-testid="upload-plan-modal">
        <div>
          <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">Upload plan</h2>
          <p className="text-[0.8125rem] text-text-muted">Build a plan from a Google Sheet you already made. Missing details are asked for afterwards, one step at a time.</p>
        </div>

        {!parsed ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (urlError || fetchMutation.isPending) return;
              fetchMutation.mutate(trimmed);
            }}
            noValidate
          >
            <section className="flex flex-col gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-[0.8125rem] text-text-muted" data-testid="upload-plan-format">
              <p className="text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">Supported format</p>
              <ul className="flex list-disc flex-col gap-1 pl-4">
                <li>
                  A <span className="font-semibold text-text">Google Sheets link</span>, shared as “Anyone with the link — Viewer”.
                </li>
                <li>
                  <span className="font-semibold text-text">Tab 1 — Details:</span> <span className="font-semibold text-text">Field | Value</span> rows — Plan name, Client name, Client contact, Company, GST number, Address, Budget, GST %, Brief.
                </li>
                <li>
                  <span className="font-semibold text-text">Tab 2 — Pages:</span> a table with a header row: Handle (no @), Page link, Category, Followers, Format, Posts per profile, Cost, Client cost.
                </li>
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => downloadTemplate("details")}>
                  <DownloadIcon className="h-3.5 w-3.5" />
                  Details tab template (.csv)
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => downloadTemplate("pages")}>
                  <DownloadIcon className="h-3.5 w-3.5" />
                  Pages tab template (.csv)
                </Button>
              </div>
              <p className="text-[0.72rem] text-text-faint">In Google Sheets: File → Import → Upload each .csv as a new sheet (tab), fill them in, then paste the sheet's link below.</p>
            </section>
            <Field label="Google Sheet link">
              <TextField type="url" value={url} onChange={setUrl} name="sourceSheetUrl" placeholder="https://docs.google.com/spreadsheets/…" autoFocus aria-invalid={touched && Boolean(urlError)} />
              {touched && <FieldError message={urlError} />}
            </Field>
            {fetchMutation.isError && <ErrorNotice message={fetchMutation.error instanceof ApiError ? fetchMutation.error.message : "Couldn't fetch that sheet."} />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={fetchMutation.isPending}>
                {fetchMutation.isPending ? "Fetching…" : "Fetch sheet"}
              </Button>
            </div>
          </form>
        ) : (
          <form
            className="flex flex-col gap-4"
            data-testid="upload-plan-review"
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (nameError || clientError || createMutation.isPending) return;
              createMutation.mutate();
            }}
            noValidate
          >
            {empty ? (
              <ErrorNotice message='Nothing readable in that sheet — check the Details tab has "Field | Value" rows and the Pages tab has a header row starting with "Handle".' />
            ) : (
              <div className="rounded-md bg-surface-2 px-3 py-2.5 text-[0.8125rem]" data-testid="upload-plan-summary">
                <p className="font-semibold">
                  {parsed.rows.length} page{parsed.rows.length === 1 ? "" : "s"} found
                  {parsed.fields.budget != null ? ` · budget ${money(parsed.fields.budget)}` : ""}
                  {parsed.fields.gstPercent != null ? ` · GST ${parsed.fields.gstPercent}%` : ""}
                </p>
                <p className="text-text-muted">
                  {(["clientContact", "clientCompany", "clientGstNumber", "clientAddress", "notes", "budget", "gstPercent"] as const).filter((k) => parsed.fields[k] == null).length > 0
                    ? `Not in the sheet: ${(["notes", "clientContact", "budget", "gstPercent", "clientCompany", "clientGstNumber", "clientAddress"] as const)
                        .filter((k) => parsed.fields[k] == null)
                        .map((k) => ({ notes: "brief", clientContact: "client contact", budget: "budget", gstPercent: "GST %", clientCompany: "company", clientGstNumber: "GST number", clientAddress: "address" })[k])
                        .join(", ")} — you'll be asked for the required ones after creating.`
                    : "Every plan detail is in the sheet."}
                </p>
                {parsed.warnings.map((w) => (
                  <p key={w} className="text-rose">
                    {w}
                  </p>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Plan name">
                <TextField value={name} onChange={setName} name="name" maxLength={150} aria-invalid={touched && Boolean(nameError)} />
                {touched && <FieldError message={nameError} />}
              </Field>
              <Field label="Client name">
                <TextField value={clientName} onChange={setClientName} name="clientName" maxLength={150} aria-invalid={touched && Boolean(clientError)} />
                {touched && <FieldError message={clientError} />}
              </Field>
            </div>
            {createMutation.isError && <ErrorNotice message={createMutation.error instanceof ApiError ? createMutation.error.message : "Couldn't create the plan."} />}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setParsed(null)}>
                ← Different sheet
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending || Boolean(empty)}>
                  {createMutation.isPending ? "Creating…" : "Create plan"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </Sheet>
  );
}
