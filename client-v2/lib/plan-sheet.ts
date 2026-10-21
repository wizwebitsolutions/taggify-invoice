import Papa from "papaparse";

import { ApiError, type Plan, type SheetPendingEntry } from "@/lib/api-client";
import { FORMATS, formatFromText, isFormat, joinLabels } from "@/lib/formats";
import { HANDLE_HEADERS, mapPageRow, PAGE_URL_HEADERS, parseMoney, readText, type CsvSource, type ParsedPlanPageRow } from "@/lib/sheet-import";

/**
 * Plans made from a Google Sheet ("New plan from sheet" / "Sync from sheet").
 * Ported from client/lib/parseAssignmentSheet.ts (parsePlanSheet) and
 * client/lib/plan-missing.ts so both apps read a plan sheet the same way:
 *  - a Details tab of `Field | Value` rows (plan name, client, budget, GST %, brief, …);
 *  - a Pages tab whose header row starts with a handle or page-link column.
 * Tabs are told apart by content, so one tab holding both still works.
 */
export interface ParsedPlanSheet {
  fields: {
    name?: string;
    clientName?: string;
    clientContact?: string;
    clientCompany?: string;
    clientGstNumber?: string;
    clientAddress?: string;
    notes?: string;
    budget?: number;
    gstPercent?: number;
  };
  /** `line` is the row's number in its sheet tab, so a problem can point at it. */
  rows: PlanSheetRow[];
  warnings: string[];
}
export type PlanSheetRow = ParsedPlanPageRow & { line: number };

const FIELD_ALIASES: Record<keyof ParsedPlanSheet["fields"], string[]> = {
  name: ["plan name", "plan", "name", "title", "campaign", "campaign name"],
  clientName: ["client name", "client", "brand", "brand name"],
  clientContact: ["client contact", "contact", "contact person", "poc"],
  clientCompany: ["company", "company name", "client company"],
  clientGstNumber: ["gst number", "gst no", "gst no.", "gstin", "gst"],
  clientAddress: ["address", "billing address", "company address"],
  notes: ["brief", "notes", "note", "description", "objective"],
  budget: ["budget", "total budget", "budget (inr)", "budget (₹)"],
  gstPercent: ["gst %", "gst%", "gst percent", "gst percentage", "gst rate"],
};

const isPageTableHeader = (row: string[] | undefined) => {
  const first = (row?.[0] ?? "").trim().toLowerCase();
  return HANDLE_HEADERS.includes(first) || PAGE_URL_HEADERS.includes(first);
};

export async function parsePlanSheet(tabs: CsvSource[]): Promise<ParsedPlanSheet> {
  const texts = await Promise.all(tabs.map(readText));
  const fields: ParsedPlanSheet["fields"] = {};
  const warnings: string[] = [];
  let rows: PlanSheetRow[] = [];
  let pagesSeen = false;

  for (const text of texts) {
    // Blank lines are kept so a row's index is its sheet row number (index 0 = row 1).
    const { data } = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false });
    const headerIndex = data.findIndex(isPageTableHeader);
    readDetailRows(headerIndex === -1 ? data : data.slice(0, headerIndex), fields, warnings);
    // The first page table wins; a second one is almost certainly a copy.
    if (headerIndex !== -1 && !pagesSeen) {
      pagesSeen = true;
      const headers = data[headerIndex].map((h) => h.trim());
      rows = data.slice(headerIndex + 1).flatMap((r, i) => {
        const row = mapPageRow(Object.fromEntries(headers.map((h, j) => [h, r[j] ?? ""])));
        return row && !/^total$/i.test(row.handle) ? [{ ...row, line: headerIndex + i + 2 }] : [];
      });
    }
  }
  return { fields, rows, warnings };
}

function readDetailRows(topRows: string[][], fields: ParsedPlanSheet["fields"], warnings: string[]) {
  for (const r of topRows) {
    const label = (r[0] ?? "").trim().toLowerCase().replace(/[:*]+$/, "").trim();
    const value = (r[1] ?? "").trim();
    if (!label || !value) continue;
    const key = (Object.keys(FIELD_ALIASES) as (keyof ParsedPlanSheet["fields"])[]).find((k) => FIELD_ALIASES[k].includes(label));
    if (!key) continue;
    if (key === "budget") {
      const n = parseMoney(value);
      if (n && n > 0) fields.budget = n;
      else warnings.push(`Budget "${value}" isn't a number.`);
    } else if (key === "gstPercent") {
      const digits = value.replace(/[^\d.]/g, "");
      const n = Number(digits);
      if (digits && Number.isInteger(n) && n >= 0 && n <= 100) fields.gstPercent = n;
      else warnings.push(`GST % "${value}" isn't a whole number between 0 and 100.`);
    } else if (key === "clientGstNumber") {
      fields.clientGstNumber = value.toUpperCase();
    } else {
      fields[key] = value;
    }
  }
}

// ── Pre-flight: what the server will refuse (server/src/modules/plans/schemas.js) ──

/** planSheetRowSchema is checked as one array of at most this many rows (sheetRows). */
export const PLAN_SHEET_MAX_ROWS = 500;

/** sheetFields' text limits, with the name the sheet's Details tab uses. */
const FIELD_LIMITS: Record<Exclude<keyof ParsedPlanSheet["fields"], "budget" | "gstPercent">, { label: string; max: number }> = {
  name: { label: "Plan name", max: 150 },
  clientName: { label: "Client name", max: 150 },
  clientContact: { label: "Client contact", max: 200 },
  clientCompany: { label: "Company", max: 150 },
  clientGstNumber: { label: "GST number", max: 40 },
  clientAddress: { label: "Address", max: 300 },
  notes: { label: "Brief", max: 1000 },
};


export interface SkippedSheetRow {
  line: number;
  handle: string;
  reasons: string[];
}

export interface PlanSheetCheck {
  /** Rows the server will accept, cleaned and without line numbers. */
  rows: ParsedPlanPageRow[];
  /** Rows left out, in sheet order, with every reason. */
  skipped: SkippedSheetRow[];
  /** Problems that stop the whole send: a Details value that's too long, or too many rows. */
  blockers: string[];
}

function checkRow(r: PlanSheetRow): { row: ParsedPlanPageRow | null; reasons: string[] } {
  const reasons: string[] = [];
  if (r.handle.length > 60) reasons.push("Handle is longer than 60 characters");
  if (r.pageUrl && r.pageUrl.length > 300) reasons.push("Page link is longer than 300 characters");
  if (r.category && r.category.length > 60) reasons.push("Category is longer than 60 characters");
  // "Reels", "Static", "Reel + Story"… are what people type; a plan line takes any of the five formats.
  const format = r.format ? (isFormat(r.format) ? r.format : (formatFromText(r.format) ?? undefined)) : undefined;
  if (r.format && !format) reasons.push(`Format "${r.format}" isn't ${joinLabels(FORMATS, "or")}`);
  if (r.postsPerProfile != null && (r.postsPerProfile < 1 || r.postsPerProfile > 1000)) reasons.push("Posts per profile must be between 1 and 1,000");
  if (reasons.length) return { row: null, reasons };
  const { line: _line, ...rest } = r;
  // Follower counts like "1.25K" can land between whole numbers; the server takes whole counts only.
  return { row: { ...rest, format, followers: rest.followers != null ? Math.round(rest.followers) : undefined }, reasons };
}

/**
 * Checks a parsed plan sheet against the server's limits before anything is sent, so one
 * bad cell can't fail the whole request. Bad rows are left out and listed; a Details value
 * that's too long, or more than 500 page rows, blocks the send. `skipFields` leaves out
 * fields the caller collects itself (the create dialog's plan and client name boxes).
 */
export function checkPlanSheet(parsed: ParsedPlanSheet, skipFields: (keyof typeof FIELD_LIMITS)[] = []): PlanSheetCheck {
  const blockers: string[] = [];
  for (const [key, { label, max }] of Object.entries(FIELD_LIMITS) as [keyof typeof FIELD_LIMITS, { label: string; max: number }][]) {
    const value = parsed.fields[key];
    if (!skipFields.includes(key) && value && value.length > max) blockers.push(`${label} in the Details tab is ${value.length.toLocaleString("en-IN")} characters; the limit is ${max.toLocaleString("en-IN")}. Shorten it in the sheet.`);
  }
  const rows: ParsedPlanPageRow[] = [];
  const skipped: SkippedSheetRow[] = [];
  for (const r of parsed.rows) {
    const { row, reasons } = checkRow(r);
    if (row) rows.push(row);
    else skipped.push({ line: r.line, handle: r.handle, reasons });
  }
  if (rows.length > PLAN_SHEET_MAX_ROWS) blockers.push(`The Pages tab has ${rows.length.toLocaleString("en-IN")} pages; a plan takes at most ${PLAN_SHEET_MAX_ROWS}. Split it into two plans.`);
  return { rows, skipped, blockers };
}

/** The server's VALIDATION_ERROR only says "Invalid request body"; say what to check instead. */
export function planSheetErrorText(e: unknown, fallback: string) {
  if (e instanceof ApiError && e.code === "VALIDATION_ERROR") return "The server couldn't accept something in the sheet: a value that's too long or not allowed. Check the Details and Pages tabs, then try again.";
  return e instanceof Error ? e.message : fallback;
}

/** Fetches every tab of a plan sheet through the server and parses them. */
export async function readPlanSheet(fetchTabs: () => Promise<{ tabs: { csv: string }[] }>) {
  const { tabs } = await fetchTabs();
  return parsePlanSheet(tabs.map((t) => t.csv));
}

/** The sample for "New plan from sheet": one CSV per tab, the layout parsePlanSheet reads. */
export const PLAN_SHEET_TEMPLATE_DETAILS: string[][] = [
  ["Plan name", "Q1 Meme Push"],
  ["Client name", "Acme Foods"],
  ["Client contact", "Rohit Sharma"],
  ["Company", "Acme Foods Pvt Ltd"],
  ["GST number", "27ABCDE1234F1Z5"],
  ["Address", "12 MG Road, Pune 411001"],
  ["Budget", "150000"],
  ["GST %", "18"],
  ["Brief", "Launch reels across meme pages in the first two weeks of October"],
];
export const PLAN_SHEET_TEMPLATE_PAGES: string[][] = [
  ["Handle", "Page link", "Category", "Followers", "Format", "Posts per profile", "Cost", "Client cost"],
  ["ghantaa", "https://www.instagram.com/ghantaa/", "Meme page", "8.7M", "reel", "2", "45000", "60000"],
  ["laughter.colours", "https://www.instagram.com/laughter.colours/", "Meme page", "4.3M", "story", "1", "12000", "15000"],
  ["memes.adda", "https://www.instagram.com/memes.adda/", "Meme page", "2.1M", "static / carousel", "1", "9000", "12000"],
  ["desi.memes", "https://www.instagram.com/desi.memes/", "Meme page", "3.4M", "reel + story", "1", "30000", "40000"],
];

const csvCell = (v: string | number) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export const rowsToCsv = (rows: (string | number)[][]) => rows.map((row) => row.map(csvCell).join(",")).join("\r\n");

/** Saves rows as a .csv (with a BOM so Excel reads it as UTF-8). */
export function downloadCsv(rows: (string | number)[][], filename: string) {
  const href = URL.createObjectURL(new Blob(["﻿", rowsToCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

export const isGoogleSheetLink = (url: string) => /^https:\/\/docs\.google\.com\/spreadsheets\//i.test(url.trim());

// ── What a sheet-made plan is still missing ────────────────────────

export type MissingStepKey = "notes" | "clientContact" | "budget" | "pages";
export type PendingPage = Extract<SheetPendingEntry, { kind: "page" }>;

export interface PlanMissing {
  /** Every gap, in card order. */
  labels: string[];
  /** The gaps "Complete details" can collect, in step order. */
  steps: { key: MissingStepKey; label: string }[];
  pendingPages: PendingPage[];
  pendingBudget: Extract<SheetPendingEntry, { kind: "budget" }> | null;
}

export function planMissing(plan: Plan): PlanMissing {
  const pending = plan.sourceSheetPending ?? [];
  const pendingPages = pending.filter((p): p is PendingPage => p.kind === "page");
  const pendingBudget = pending.find((p): p is Extract<SheetPendingEntry, { kind: "budget" }> => p.kind === "budget") ?? null;

  const checks: { key: MissingStepKey | null; label: string; done: boolean }[] = [
    { key: "notes", label: "Brief", done: Boolean(plan.notes?.trim()) },
    { key: "clientContact", label: "Client contact", done: Boolean(plan.clientContact) },
    { key: "budget", label: pendingBudget ? "Budget (the sheet's is below the pages' total)" : "Budget", done: plan.budget != null },
    { key: "pages", label: "Pages", done: plan.items.length > 0 || pendingPages.length > 0 },
    { key: null, label: "Rates on every page", done: plan.items.length === 0 || plan.items.every((i) => Number(i.cost) > 0) },
    ...pendingPages.map((p) => ({ key: "pages" as const, label: p.cost == null ? `${p.handle} has no cost` : `${p.handle} isn't in Inventory yet`, done: false })),
  ];
  const missing = checks.filter((c) => !c.done);
  const stepKeys = [...new Set(missing.map((c) => c.key).filter((k): k is MissingStepKey => k !== null))];
  const stepLabel: Record<MissingStepKey, string> = { notes: "Brief", clientContact: "Client contact", budget: "Budget", pages: "Pages" };
  return { labels: missing.map((c) => c.label), steps: stepKeys.map((key) => ({ key, label: stepLabel[key] })), pendingPages, pendingBudget };
}
