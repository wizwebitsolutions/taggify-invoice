"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileSpreadsheet } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, plans as plansApi } from "@/lib/api-client";
import { money, plural } from "@/lib/format";
import { checkPlanSheet, downloadCsv, isGoogleSheetLink, PLAN_SHEET_TEMPLATE_DETAILS, PLAN_SHEET_TEMPLATE_PAGES, planSheetErrorText, readPlanSheet, type ParsedPlanSheet } from "@/lib/plan-sheet";
import { invalidateAfterPlanChange } from "@/lib/queries/plans";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/taggify/field";
import { SheetBlockers, SheetRowProblems } from "@/components/plans/sheet-row-problems";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

const OPTIONAL_LABELS = { notes: "brief", clientContact: "client contact", budget: "budget", gstPercent: "GST %", clientCompany: "company", clientGstNumber: "GST number", clientAddress: "address" } as const;

/**
 * Plans → "New plan from sheet" (POST /plans/import-sheet-tabs, then /plans/from-sheet; plans.edit).
 * Paste a Google Sheet link → see what was found → name the plan and client → Create.
 * The link is kept on the plan, so "Sync from sheet" on the plan re-reads the same sheet,
 * and anything the sheet left out is collected afterwards with "Complete details".
 */
export function PlanFromSheetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-xl">{open && <Flow onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function Flow({ onClose }: { onClose: () => void }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [parsed, setParsed] = useState<ParsedPlanSheet | null>(null);
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");

  const link = url.trim();
  const urlError = !link ? "Paste the sheet's link." : !isGoogleSheetLink(link) ? "Use a Google Sheets link: https://docs.google.com/spreadsheets/…" : link.length > 500 ? "That link is too long (500 characters max)." : null;

  const read = useMutation({
    mutationFn: () => readPlanSheet(() => plansApi.importSheetTabs(accessToken!, link)),
    onSuccess: (r) => {
      setParsed(r);
      setName(r.fields.name ?? "");
      setClientName(r.fields.clientName ?? "");
      setTouched(false);
    },
  });
  const create = useMutation({
    // Only the rows the pre-flight passed are sent, so one bad cell can't fail the whole request.
    mutationFn: () => plansApi.createFromSheet(accessToken!, { sourceSheetUrl: link, fields: { ...parsed!.fields, name: name.trim(), clientName: clientName.trim() }, rows: checkPlanSheet(parsed!).rows }),
    onSuccess: async (plan) => {
      await invalidateAfterPlanChange(qc);
      toast.success(`Plan “${plan.name}” created.`);
      onClose();
      router.push(`/plans/${plan.id}`);
    },
  });

  if (parsed) {
    const empty = parsed.rows.length === 0 && Object.keys(parsed.fields).length === 0;
    const notInSheet = (Object.keys(OPTIONAL_LABELS) as (keyof typeof OPTIONAL_LABELS)[]).filter((k) => parsed.fields[k] == null).map((k) => OPTIONAL_LABELS[k]);
    // Plan and client name are checked on their own boxes below; everything else against the server's limits.
    const check = checkPlanSheet(parsed, ["name", "clientName"]);
    const nameError = !name.trim() ? "Enter the plan's name." : name.trim().length > 150 ? "Keep the plan name to 150 characters." : null;
    const clientError = !clientName.trim() ? "Enter the client's name." : clientName.trim().length > 150 ? "Keep the client name to 150 characters." : null;
    const blocked = check.blockers.length > 0;
    return (
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!nameError && !clientError && !empty && !blocked) create.mutate();
        }}
      >
        <DialogHeader>
          <DialogTitle>Check what was found</DialogTitle>
          <DialogDescription>Name the plan and the client, then create it. Anything else the sheet left out is asked for on the plan.</DialogDescription>
        </DialogHeader>
        {empty ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-small text-danger-fg" role="alert">
            Nothing readable in that sheet. Check the Details tab has “Field, Value” rows and the Pages tab has a header row starting with “Handle”.
          </p>
        ) : (
          <div className="flex flex-col gap-1 rounded-card border p-4 text-small">
            <p className="text-body-strong">
              {plural(check.rows.length, "page")} {check.skipped.length ? "ready" : "found"}
              {parsed.fields.budget != null ? ` · budget ${money(parsed.fields.budget)}` : ""}
              {parsed.fields.gstPercent != null ? ` · GST ${parsed.fields.gstPercent}%` : ""}
            </p>
            <p className="text-muted-foreground">{notInSheet.length ? `Not in the sheet: ${notInSheet.join(", ")}.` : "Every plan detail is in the sheet."}</p>
            {parsed.warnings.map((w) => (
              <p key={w} className="text-danger-helper">
                {w}
              </p>
            ))}
          </div>
        )}
        <SheetBlockers blockers={check.blockers} />
        <SheetRowProblems skipped={check.skipped} note="They're left out of the plan. Fix them in the sheet, then use Sync from sheet on the plan." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan name" error={touched ? nameError : null}>
            {(a) => <Input {...a} maxLength={150} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Client name" error={touched ? clientError : null}>
            {(a) => <Input {...a} maxLength={150} value={clientName} onChange={(e) => setClientName(e.target.value)} />}
          </Field>
        </div>
        {create.isError && (
          <p className="text-small text-danger-helper" role="alert">
            {planSheetErrorText(create.error, "Couldn't create the plan. Try again.")}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setParsed(null);
              create.reset();
            }}
          >
            Use another sheet
          </Button>
          <Button type="submit" disabled={create.isPending || empty || blocked}>
            {create.isPending ? "Creating…" : "Create plan"}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!urlError && !read.isPending) read.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>New plan from sheet</DialogTitle>
        <DialogDescription>Build a plan from a Google Sheet you already made. Missing details are asked for afterwards, one step at a time.</DialogDescription>
      </DialogHeader>
      <Field label="Google Sheet link" description="Share it as “Anyone with the link can view”." error={touched ? urlError : null}>
        {(a) => <Input {...a} type="url" autoFocus placeholder="https://docs.google.com/spreadsheets/d/…" value={url} onChange={(e) => setUrl(e.target.value)} />}
      </Field>
      {read.isError && (
        <p className="text-small text-danger-helper" role="alert">
          {errText(read.error, "Couldn't read that sheet. Check it's shared and try again.")}
        </p>
      )}
      <div className="flex flex-col gap-2 rounded-card border p-4">
        <h3 className="text-body-strong">Sheet layout</h3>
        <p className="text-small text-muted-foreground">
          <span className="font-semibold text-foreground">Details tab:</span> two columns, Field and Value: plan name, client name, client contact, company, GST number, address, budget, GST %, brief.
        </p>
        <p className="text-small text-muted-foreground">
          <span className="font-semibold text-foreground">Pages tab:</span> a header row, then one page per row: Handle, Page link, Category, Followers, Format, Posts per profile, Cost, Client cost.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => downloadCsv(PLAN_SHEET_TEMPLATE_DETAILS, "taggify-plan-template-details.csv")}>
            <Download />
            Details tab sample
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => downloadCsv(PLAN_SHEET_TEMPLATE_PAGES, "taggify-plan-template-pages.csv")}>
            <Download />
            Pages tab sample
          </Button>
        </div>
        <p className="text-caption text-muted-foreground">In Google Sheets, File → Import → Upload each sample as its own tab, fill them in, then paste the link above.</p>
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={read.isPending}>
          <FileSpreadsheet />
          {read.isPending ? "Reading…" : "Read sheet"}
        </Button>
      </DialogFooter>
    </form>
  );
}
