"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField, TextArea, MoneyField, FieldError } from "@/components/ui/form-field";
import { ErrorNotice } from "@/components/ui/table-parts";
import { CheckCircleIcon } from "@/components/icons";
import { plans as plansApi, assets as assetsApi, ApiError, type Plan } from "@/lib/api-client";
import { planMissing, type MissingStepKey } from "@/lib/plan-missing";
import { money, count } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";

/**
 * "Complete details" for a plan uploaded from a sheet (user request, 22 Sep
 * — "if fields are missing, take input of missing fields from users in
 * steps"). One step per missing item, in plan order: Brief → Client contact
 * → Budget → Pages. Each step saves on its own (PUT /plans/:id or the
 * one-click Add to inventory), so closing half-way loses nothing and a
 * later Refresh of the sheet keeps what was typed here (blank sheet cells
 * never overwrite — see plans/service.js applySheetToPlan).
 *
 * `plan` is always the freshest copy: the parent re-renders this with the
 * plan from the ["plans"] query after every save, and the step list is
 * re-derived from it, so a step disappears the moment it's done.
 */
export function CompletePlanSteps({ token, plan, onClose }: { token: string; plan: Plan; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const missing = planMissing(plan);
  // Steps are fixed at open so finishing one advances instead of reshuffling.
  const [steps] = useState(missing.steps);
  const [index, setIndex] = useState(0);
  const step = steps[index] as { key: MissingStepKey; label: string } | undefined;
  const isLast = index >= steps.length - 1;
  const next = () => (isLast ? onClose() : setIndex((i) => i + 1));

  const [notes, setNotes] = useState(plan.notes ?? "");
  const [contact, setContact] = useState(plan.clientContact ?? "");
  const [budget, setBudget] = useState(plan.budget != null ? String(Math.round(Number(plan.budget))) : missing.pendingBudget ? String(Math.round(missing.pendingBudget.sheetBudget)) : "");
  const [touched, setTouched] = useState(false);

  // The pages on the plan plus every pending page the next step will add —
  // otherwise a budget that passes here fails the moment those are added
  // (the server checks PLAN_OVER_BUDGET on Add to inventory too).
  const budgetFloor = (plan.internal?.computedSubtotal ?? 0) + missing.pendingPages.reduce((s, p) => s + (p.clientCost ?? p.cost ?? 0) * p.postsPerProfile, 0);
  const errors: Partial<Record<MissingStepKey, string | null>> = {
    notes: notes.trim() ? null : "A brief is required.",
    clientContact: contact.trim() ? null : "Who's the contact at the client?",
    budget: !budget ? "Enter the budget." : Number(budget) < budgetFloor ? `The pages (including the ones still to add) come to ${money(budgetFloor)} — the budget can't be below that.` : null,
  };

  const saveMutation = useMutation({
    mutationFn: (body: Parameters<typeof plansApi.update>[2]) => plansApi.update(token, plan.id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      setTouched(false);
      next();
    },
  });
  const saveStep = () => {
    if (!step) return;
    setTouched(true);
    if (errors[step.key]) return;
    if (step.key === "notes") saveMutation.mutate({ notes: notes.trim() });
    else if (step.key === "clientContact") saveMutation.mutate({ clientContact: contact.trim() });
    else if (step.key === "budget") saveMutation.mutate({ budget: Number(budget) });
  };

  // Pages step — one-click Add to inventory per pending row. An Admin may
  // put the page under a creator account (assets/service.js createAsset's
  // rule); everyone else registers it under their own.
  const isAdmin = user?.role === "ADMIN";
  const ownersQuery = useQuery({ queryKey: ["assets", "owners"], queryFn: () => assetsApi.owners(token), enabled: isAdmin && step?.key === "pages" });
  const [ownerId, setOwnerId] = useState("");
  const addMutation = useMutation({
    mutationFn: (handle: string) => plansApi.addPendingPage(token, plan.id, { handle, ...(isAdmin && ownerId ? { ownerId } : {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
  const addable = missing.pendingPages.filter((p) => p.cost != null);
  const noCost = missing.pendingPages.filter((p) => p.cost == null);

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[560px]">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6 pt-1" data-testid="complete-plan-steps">
        <div>
          <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">Complete details</h2>
          <p className="text-[0.8125rem] text-text-muted">
            {plan.name} · {steps.length === 0 ? "nothing missing" : `step ${Math.min(index + 1, steps.length)} of ${steps.length}`}
          </p>
        </div>
        {steps.length > 1 && (
          <ol className="flex flex-wrap gap-1.5" aria-label="Steps">
            {steps.map((s, i) => (
              <li key={s.key} className={`rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold ${i === index ? "bg-ink text-white" : i < index ? "bg-accent-soft text-accent" : "bg-surface-2 text-text-faint"}`}>
                {s.label}
              </li>
            ))}
          </ol>
        )}

        {!step ? (
          <div className="flex flex-col gap-4">
            <p className="flex items-center gap-1.5 rounded-md bg-accent-soft px-3 py-2 text-[0.8125rem] font-semibold text-accent">
              <CheckCircleIcon className="h-4 w-4" /> All details filled.
            </p>
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : step.key === "pages" ? (
          <div className="flex flex-col gap-4" data-testid="step-pages">
            <p className="text-[0.8125rem] text-text-muted">
              {missing.pendingPages.length === 0
                ? "Every page in the sheet is on the plan now."
                : "These pages are in the sheet but not on the plan yet. Adding one registers it in Inventory and puts it on the plan with the sheet's cost."}
            </p>
            {isAdmin && addable.length > 0 && (
              <Field label="Register new pages under">
                <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} aria-label="Register new pages under" className="h-10 rounded-md border border-border-strong bg-surface px-3 text-[0.875rem] text-text">
                  <option value="">My own account</option>
                  {(ownersQuery.data ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name ? `${o.name} · ${o.phoneNumber}` : o.phoneNumber}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <ul className="flex flex-col gap-2">
              {addable.map((p) => (
                <li key={p.handle} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-[0.8125rem]" data-testid={`pending-page-${p.handle}`}>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {p.pageUrl ? (
                        <a href={p.pageUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          @{p.handle} ↗
                        </a>
                      ) : (
                        `@${p.handle}`
                      )}
                    </p>
                    <p className="truncate text-[0.72rem] text-text-faint">
                      {[p.category, p.followers != null ? `${count(p.followers)} followers` : null, p.format, `${money(p.cost ?? 0)} × ${p.postsPerProfile}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => addMutation.mutate(p.handle)} disabled={addMutation.isPending}>
                    {addMutation.isPending && addMutation.variables === p.handle ? "Adding…" : "Add to inventory"}
                  </Button>
                </li>
              ))}
              {noCost.map((p) => (
                <li key={p.handle} className="rounded-md border border-dashed border-border px-3 py-2 text-[0.8125rem]" data-testid={`pending-page-${p.handle}`}>
                  <p className="font-semibold">@{p.handle}</p>
                  <p className="text-[0.72rem] text-text-faint">{p.reason} Put a cost in the sheet, then Refresh.</p>
                </li>
              ))}
            </ul>
            {addMutation.isError && <ErrorNotice message={addMutation.error instanceof ApiError ? addMutation.error.message : "Couldn't add that page."} />}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                {missing.pendingPages.length === 0 ? "Done" : "Later"}
              </Button>
              {missing.pendingPages.length === 0 && !isLast && <Button onClick={next}>Next</Button>}
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            data-testid={`step-${step.key}`}
            onSubmit={(e) => {
              e.preventDefault();
              saveStep();
            }}
            noValidate
          >
            {step.key === "notes" && (
              <Field label="Brief">
                <TextArea value={notes} onChange={setNotes} name="notes" placeholder="What this plan is for — deliverables, timing, anything the client asked for." maxLength={1000} rows={4} autoFocus aria-invalid={touched && Boolean(errors.notes)} />
                {touched && <FieldError message={errors.notes} />}
              </Field>
            )}
            {step.key === "clientContact" && (
              <Field label="Client contact">
                <TextField value={contact} onChange={setContact} name="clientContact" placeholder="Rohit Sharma" maxLength={200} autoFocus aria-invalid={touched && Boolean(errors.clientContact)} />
                {touched && <FieldError message={errors.clientContact} />}
              </Field>
            )}
            {step.key === "budget" && (
              <Field label="Budget">
                <MoneyField value={budget} onChange={setBudget} name="budget" autoFocus aria-invalid={touched && Boolean(errors.budget)} />
                {missing.pendingBudget && <p className="text-[0.72rem] text-text-faint">{missing.pendingBudget.reason}</p>}
                {touched && <FieldError message={errors.budget} />}
              </Field>
            )}
            {saveMutation.isError && <ErrorNotice message={saveMutation.error instanceof ApiError ? saveMutation.error.message : "Couldn't save that."} />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Later
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : isLast ? "Save & finish" : "Save & next"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Sheet>
  );
}
