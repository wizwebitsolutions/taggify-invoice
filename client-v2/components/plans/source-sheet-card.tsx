"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleCheck, ExternalLink, ListChecks, RefreshCw } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, plans as plansApi, type Plan } from "@/lib/api-client";
import { canAddForOwner } from "@/lib/creators";
import { money, personLabel, plural } from "@/lib/format";
import { checkPlanSheet, planMissing, planSheetErrorText, readPlanSheet, type MissingStepKey, type SkippedSheetRow } from "@/lib/plan-sheet";
import { usePageOwners } from "@/lib/queries/creators";
import { invalidateAfterPlanChange } from "@/lib/queries/plans";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, inputClass } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/taggify/field";
import { audienceLabel, displayHandle } from "@/components/finance/identity";
import { formatName } from "@/lib/plans";
import { SheetBlockers, SheetRowProblems } from "@/components/plans/sheet-row-problems";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/**
 * Plan detail rail → "From a sheet" (plans made with "New plan from sheet").
 * Sync re-reads the same stored link (POST /plans/:id/sheet-sync, drafts only; blank
 * cells keep what's in the app). What the sheet left out is listed, and
 * "Complete details" collects it one step at a time.
 */
export function SourceSheetCard({ plan: p, editable }: { plan: Plan; editable: boolean }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const [completing, setCompleting] = useState(false);
  const missing = planMissing(p);
  const canSync = editable && p.status === "DRAFT";

  // What the last sync left out or refused (pre-flight against the server's limits), shown under the button.
  const [syncSkipped, setSyncSkipped] = useState<SkippedSheetRow[]>([]);
  const [syncBlockers, setSyncBlockers] = useState<string[]>([]);
  const sync = useMutation({
    mutationFn: async () => {
      setSyncSkipped([]);
      setSyncBlockers([]);
      const parsed = await readPlanSheet(() => plansApi.importSheetTabs(accessToken!, p.sourceSheetUrl!));
      const check = checkPlanSheet(parsed);
      if (check.blockers.length) return { blockers: check.blockers, skipped: check.skipped };
      await plansApi.syncFromSheet(accessToken!, p.id, { fields: parsed.fields, rows: check.rows });
      return { blockers: [], skipped: check.skipped };
    },
    onSuccess: async ({ blockers, skipped }) => {
      setSyncSkipped(skipped);
      setSyncBlockers(blockers);
      if (blockers.length) {
        toast.error("Nothing was synced. Fix the sheet first.");
        return;
      }
      await invalidateAfterPlanChange(qc);
      toast.success(skipped.length ? `Plan synced from the sheet. ${plural(skipped.length, "row")} left out.` : "Plan synced from the sheet.");
    },
    onError: (e) => toast.error(planSheetErrorText(e, "Couldn't read the sheet. Check it's shared and try again.")),
  });

  if (!p.sourceSheetUrl) return null;
  return (
    <Card className="p-5">
      <h2 className="mb-1 text-card-title">From a sheet</h2>
      <p className="mb-3 text-small text-muted-foreground">
        {canSync ? "Edit the sheet, then sync: blank cells keep what's in the app." : p.status === "DRAFT" ? "This plan was built from a Google Sheet." : "Built from a Google Sheet. Only a draft can be synced."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <a href={p.sourceSheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-small font-semibold underline underline-offset-4">
          Open sheet <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
        {canSync && (
          <Button size="sm" variant="outline" className="ml-auto" disabled={sync.isPending} onClick={() => sync.mutate()}>
            <RefreshCw />
            {sync.isPending ? "Syncing…" : "Sync from sheet"}
          </Button>
        )}
      </div>
      {(syncBlockers.length > 0 || syncSkipped.length > 0) && (
        <div className="mt-3 flex flex-col gap-3">
          <SheetBlockers blockers={syncBlockers} />
          <SheetRowProblems skipped={syncSkipped} note={syncBlockers.length ? "Fix them too before syncing again." : "They were left out of the sync. Fix them in the sheet, then sync again."} />
        </div>
      )}
      {p.sourceSheetFetchedAt && <p className="mt-2 text-small text-muted-foreground">Last synced {new Date(p.sourceSheetFetchedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>}

      <div className="mt-4 border-t pt-4">
        {missing.labels.length === 0 ? (
          <p className="flex items-center gap-2 text-small font-semibold text-success-fg">
            <CircleCheck className="h-4 w-4" aria-hidden />
            Every detail is filled.
          </p>
        ) : (
          <>
            <p className="text-body-strong">Still missing</p>
            <ul className="mt-2 flex flex-col gap-1 text-small text-muted-foreground">
              {missing.labels.slice(0, 6).map((l) => (
                <li key={l}>{l}</li>
              ))}
              {missing.labels.length > 6 && <li>and {missing.labels.length - 6} more</li>}
            </ul>
            {editable && missing.steps.length > 0 && (
              <Button size="sm" className="mt-3" onClick={() => setCompleting(true)}>
                <ListChecks />
                Complete details
              </Button>
            )}
          </>
        )}
      </div>
      <Dialog open={completing} onOpenChange={setCompleting}>
        <DialogContent className="max-h-screen overflow-y-auto sm:max-w-lg">{completing && <CompleteSteps plan={p} onClose={() => setCompleting(false)} />}</DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * One step per gap, in plan order: Brief → Client contact → Budget → Pages. Each step saves
 * on its own, so closing half-way loses nothing. `plan` is always the freshest copy (the
 * parent re-renders after every save), but the step list is fixed at open so finishing one
 * advances instead of reshuffling.
 */
function CompleteSteps({ plan: p, onClose }: { plan: Plan; onClose: () => void }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const missing = planMissing(p);
  const [steps] = useState(missing.steps);
  const [index, setIndex] = useState(0);
  const step = steps[index] as { key: MissingStepKey; label: string } | undefined;
  const isLast = index >= steps.length - 1;
  const next = () => (isLast ? onClose() : setIndex((i) => i + 1));

  const [notes, setNotes] = useState(p.notes ?? "");
  const [contact, setContact] = useState(p.clientContact ?? "");
  const [budget, setBudget] = useState(p.budget != null ? String(Math.round(Number(p.budget))) : missing.pendingBudget ? String(Math.round(missing.pendingBudget.sheetBudget)) : "");
  const [touched, setTouched] = useState(false);

  // The pages on the plan plus every pending page still to add, so a budget that passes
  // here doesn't fail the moment those are added (the server checks PLAN_OVER_BUDGET there too).
  const budgetFloor = (p.internal?.computedSubtotal ?? 0) + missing.pendingPages.reduce((s, x) => s + (x.clientCost ?? x.cost ?? 0) * x.postsPerProfile, 0);
  const errors: Partial<Record<MissingStepKey, string | null>> = {
    notes: notes.trim() ? null : "Write a short brief.",
    clientContact: contact.trim() ? null : "Who's the contact at the client?",
    // A budget below what the pages cost is allowed (16 Oct: over budget is a warning, not a block).
    budget: !/^\d{1,10}$/.test(budget) ? "Enter the budget in whole rupees." : null,
  };

  const save = useMutation({
    mutationFn: (body: Parameters<typeof plansApi.update>[2]) => plansApi.update(accessToken!, p.id, body),
    onSuccess: async () => {
      await invalidateAfterPlanChange(qc);
      setTouched(false);
      next();
    },
  });
  const saveStep = () => {
    if (!step) return;
    setTouched(true);
    if (errors[step.key]) return;
    if (step.key === "notes") save.mutate({ notes: notes.trim() });
    else if (step.key === "clientContact") save.mutate({ clientContact: contact.trim() });
    else if (step.key === "budget") save.mutate({ budget: Number(budget) });
  };

  // Pages step: one click per pending row registers the page and puts it on the plan.
  // An admin may register it under a creator's account; anyone else gets it under their own.
  const pickOwner = user?.role === "ADMIN" && canAddForOwner(user);
  const owners = usePageOwners(pickOwner && step?.key === "pages");
  const [ownerId, setOwnerId] = useState("self");
  const add = useMutation({
    mutationFn: (handle: string) => plansApi.addPendingPage(accessToken!, p.id, { handle, ...(pickOwner && ownerId !== "self" ? { ownerId } : {}) }),
    onSuccess: async (_r, handle) => {
      await Promise.all([invalidateAfterPlanChange(qc), qc.invalidateQueries({ queryKey: ["assets"] })]);
      toast.success(`${displayHandle(handle)} added to Inventory and the plan.`);
    },
  });
  const addable = missing.pendingPages.filter((x) => x.cost != null);
  const noCost = missing.pendingPages.filter((x) => x.cost == null);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Complete details</DialogTitle>
        <DialogDescription>
          {p.name} · {steps.length === 0 ? "nothing missing" : `step ${Math.min(index + 1, steps.length)} of ${steps.length}`}
        </DialogDescription>
      </DialogHeader>
      {steps.length > 1 && (
        <ol className="flex flex-wrap gap-2" aria-label="Steps">
          {steps.map((s, i) => (
            <li key={s.key} aria-current={i === index ? "step" : undefined} className={cn("rounded-pill px-3 py-1 text-caption font-semibold", i === index ? "bg-primary text-primary-foreground" : i < index ? "bg-success-soft text-success-fg" : "bg-muted text-muted-foreground")}>
              {s.label}
            </li>
          ))}
        </ol>
      )}

      {!step ? (
        <>
          <p className="flex items-center gap-2 text-body-strong text-success-fg">
            <CircleCheck className="h-4 w-4" aria-hidden />
            Every detail is filled.
          </p>
          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </>
      ) : step.key === "pages" ? (
        <>
          <p className="text-small text-muted-foreground">
            {missing.pendingPages.length === 0 ? "Every page in the sheet is on the plan now." : "These pages are in the sheet but not on the plan yet. Adding one registers it in Inventory and puts it on the plan at the sheet's cost."}
          </p>
          {pickOwner && addable.length > 0 && (
            <Field label="Register new pages under">
              {(a) => (
                <Select value={ownerId} onValueChange={setOwnerId}>
                  <SelectTrigger {...a}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self">My own account</SelectItem>
                    {(owners.data ?? []).map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {personLabel(o)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          )}
          {missing.pendingPages.length > 0 && (
            <ul className="flex flex-col divide-y rounded-card border">
              {addable.map((x) => (
                <li key={x.handle} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-strong">{displayHandle(x.handle)}</span>
                    <span className="block truncate text-small text-muted-foreground">
                      {[x.category, audienceLabel(x.followers), x.format ? formatName(x.format) : null, `${money(x.cost ?? 0)} × ${x.postsPerProfile}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" disabled={add.isPending} onClick={() => add.mutate(x.handle)}>
                    {add.isPending && add.variables === x.handle ? "Adding…" : "Add to plan"}
                  </Button>
                </li>
              ))}
              {noCost.map((x) => (
                <li key={x.handle} className="px-4 py-3">
                  <span className="block text-body-strong">{displayHandle(x.handle)}</span>
                  <span className="block text-small text-muted-foreground">No cost in the sheet. Add one there, then sync.</span>
                </li>
              ))}
            </ul>
          )}
          {add.isError && (
            <p className="text-small text-danger-helper" role="alert">
              {errText(add.error, "Couldn't add that page.")}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onClose}>
              {missing.pendingPages.length === 0 ? "Done" : "Later"}
            </Button>
            {missing.pendingPages.length === 0 && !isLast && <Button onClick={next}>Next</Button>}
          </DialogFooter>
        </>
      ) : (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            saveStep();
          }}
        >
          {step.key === "notes" && (
            <Field label="Brief" error={touched ? errors.notes : null}>
              {(a) => <textarea {...a} rows={4} maxLength={1000} autoFocus className={cn(inputClass, "h-auto py-2")} placeholder="What the client wants, key dates, must-haves" value={notes} onChange={(e) => setNotes(e.target.value)} />}
            </Field>
          )}
          {step.key === "clientContact" && (
            <Field label="Client contact" error={touched ? errors.clientContact : null}>
              {(a) => <Input {...a} maxLength={200} autoFocus placeholder="Rohit Sharma" value={contact} onChange={(e) => setContact(e.target.value)} />}
            </Field>
          )}
          {step.key === "budget" && (
            <Field label="Budget (₹)" description={/^\d{1,10}$/.test(budget) && Number(budget) < budgetFloor ? `The pages, including the ones still to add, come to ${money(budgetFloor)}. This budget would be over by ${money(budgetFloor - Number(budget))}; that's allowed.` : missing.pendingBudget?.reason} error={touched ? errors.budget : null}>
              {(a) => <Input {...a} inputMode="numeric" autoFocus value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ""))} />}
            </Field>
          )}
          {save.isError && (
            <p className="text-small text-danger-helper" role="alert">
              {errText(save.error, "Couldn't save that. Try again.")}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Later
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : isLast ? "Save and finish" : "Save and next"}
            </Button>
          </DialogFooter>
        </form>
      )}
      {missing.pendingPages.length > 0 && step?.key !== "pages" && <p className="text-caption text-muted-foreground">{plural(missing.pendingPages.length, "page")} from the sheet still to add.</p>}
    </>
  );
}
