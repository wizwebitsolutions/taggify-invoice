"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField, FieldError } from "@/components/ui/form-field";
import { ErrorNotice } from "@/components/ui/table-parts";
import { DownloadIcon } from "@/components/icons";
import { GoogleAwareError } from "@/components/integrations/google-reconnect-notice";
import { plans as plansApi, ApiError, type Plan } from "@/lib/api-client";
import { count } from "@/lib/format";

/**
 * Plan card → "Attach execution sheet" popup (user request, 21 Sep — "give
 * in which format attachment sheet should be attached, also give option of
 * downloading template ... pop up will be opened by clicking attach
 * execution sheet"). Replaces the card's old inline link field: the popup
 * says what the sheet must look like (the same sample the server builds in
 * lib/planSheet.js, shown as a table), hands out that sample as a .csv or a
 * live Google Sheet, and only then takes the link.
 *
 * Since 23 Sep the saved link is also read straight away on an approved
 * plan (rows with a Posted Link become the creators' links) — the card
 * shows the result; `onSaved` gets the PUT response so a sync problem
 * (`executionSheetSyncError`) can be surfaced there.
 */
type Template = Awaited<ReturnType<typeof plansApi.previewExecutionSheetTemplate>>;

const csvCell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export const rowsToCsv = (rows: (string | number)[][]) => rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
export const templateToCsv = (t: Template) => rowsToCsv([t.headers, ...t.rows, t.totalsRow]);

export function ExecutionSheetModal({ token, plan, onClose, onSaved }: { token: string; plan: Plan; onClose: () => void; onSaved: (updated: Plan) => void }) {
  const [url, setUrl] = useState(plan.executionSheetUrl ?? "");
  const [touched, setTouched] = useState(false);
  const templateQuery = useQuery({ queryKey: ["plans", "execution-sheet-template"], queryFn: () => plansApi.previewExecutionSheetTemplate(token), staleTime: Infinity });
  const template = templateQuery.data;

  const trimmed = url.trim();
  const urlError = !trimmed
    ? "Paste the sheet's link."
    : !/^https?:\/\/\S+$/i.test(trimmed)
    ? "Enter a full link starting with https://"
    : !/^https:\/\/docs\.google\.com\/spreadsheets\//i.test(trimmed)
    ? "Only Google Sheets links are supported — https://docs.google.com/spreadsheets/…"
    : trimmed.length > 500
    ? "That link is too long (500 characters max)."
    : null;

  const saveMutation = useMutation({
    mutationFn: (next: string | null) => plansApi.update(token, plan.id, { executionSheetUrl: next }),
    onSuccess: (updated) => {
      onSaved(updated);
      onClose();
    },
  });
  // The live Google Sheet copy needs the workspace's Google connection; the
  // .csv below doesn't, so there's always one way to get the template.
  // The blank tab is opened inside the click (see openGoogleTemplate) and only
  // pointed at the sheet here — a window.open after the awaited call would be
  // popup-blocked, same reason as app/plans/page.tsx's sheetMutation.
  const googleTemplateMutation = useMutation({
    mutationFn: async (tab: Window | null) => {
      try {
        const { spreadsheetUrl } = await plansApi.getExecutionSheetTemplate(token);
        tab?.location.assign(spreadsheetUrl);
      } catch (err) {
        tab?.close();
        throw err;
      }
    },
  });
  const openGoogleTemplate = () => googleTemplateMutation.mutate(window.open("", "_blank"));

  const downloadCsv = () => {
    if (!template) return;
    // BOM so Excel opens it as UTF-8.
    const href = URL.createObjectURL(new Blob(["﻿", templateToCsv(template)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = "taggify-execution-sheet-template.csv";
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[640px]">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6 pt-1" data-testid="execution-sheet-modal">
        <div>
          <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">{plan.executionSheetUrl ? "Change execution sheet" : "Attach execution sheet"}</h2>
          <p className="text-[0.8125rem] text-text-muted">{plan.name} · the sheet tracking what was actually posted.</p>
        </div>

        <section className="flex flex-col gap-2" data-testid="execution-sheet-format">
          <p className="text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">Supported format</p>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-[0.8125rem] text-text-muted">
            <li>
              A <span className="font-semibold text-text">Google Sheets link</span> (docs.google.com/spreadsheets/…) — not an uploaded Excel/PDF file.
            </li>
            <li>
              Shared as <span className="font-semibold text-text">“Anyone with the link — Viewer”</span>, so the team can open it.
            </li>
            <li>One row per published post, with these columns in this order, and a TOTAL row at the end:</li>
          </ul>
          {templateQuery.isError ? (
            <ErrorNotice message="Couldn't load the template preview." />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-[0.72rem] tabular-nums" data-testid="execution-sheet-template-table">
                <thead className="bg-surface-2 text-text-faint">
                  <tr>{(template?.headers ?? []).map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {(template?.rows ?? []).map((row, r) => (
                    <tr key={r} className="border-t border-border">
                      {row.map((cell, c) => (
                        <td key={c} className="max-w-[140px] truncate whitespace-nowrap px-2 py-1.5">{typeof cell === "number" && c > 0 ? count(cell) : cell}</td>
                      ))}
                    </tr>
                  ))}
                  {template && (
                    <tr className="border-t border-border bg-surface-2 font-semibold">
                      {template.totalsRow.map((cell, c) => <td key={c} className="whitespace-nowrap px-2 py-1.5">{typeof cell === "number" ? count(cell) : cell}</td>)}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={downloadCsv} disabled={!template}>
              <DownloadIcon className="h-3.5 w-3.5" />
              Download template (.csv)
            </Button>
            <Button size="sm" variant="ghost" onClick={openGoogleTemplate} disabled={googleTemplateMutation.isPending}>
              {googleTemplateMutation.isPending ? "Opening…" : "Open as Google Sheet ↗"}
            </Button>
          </div>
          <p className="text-[0.72rem] text-text-faint">Using the .csv: in Google Sheets choose File → Import → Upload, fill it in, then paste that sheet's link below.</p>
          {googleTemplateMutation.isError && (
            <>
              <GoogleAwareError error={googleTemplateMutation.error} fallback="Couldn't open the Google Sheet template." />
              <p className="text-[0.72rem] text-text-faint">The .csv template above works without Google.</p>
            </>
          )}
        </section>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (urlError || saveMutation.isPending) return;
            saveMutation.mutate(trimmed);
          }}
          noValidate
        >
          <Field label="Execution sheet link">
            <TextField type="url" value={url} onChange={setUrl} name="executionSheetUrl" aria-label={`${plan.name} execution sheet link`} placeholder="https://docs.google.com/spreadsheets/…" aria-invalid={touched && Boolean(urlError)} />
            {touched && <FieldError message={urlError} />}
          </Field>
          {saveMutation.isError && <ErrorNotice message={saveMutation.error instanceof ApiError ? saveMutation.error.message : "Couldn't save that link."} />}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {plan.executionSheetUrl ? (
              <Button type="button" variant="ghost" onClick={() => saveMutation.mutate(null)} disabled={saveMutation.isPending}>
                Remove sheet
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : "Attach sheet"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </Sheet>
  );
}
