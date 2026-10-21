"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, plans as plansApi, type Plan } from "@/lib/api-client";
import { useAssets } from "@/lib/queries/finance";
import { invalidateAfterPlanChange, useSavedClients } from "@/lib/queries/plans";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/taggify/money";
import { type Basics, basicsComplete, basicsFromPlan, BasicsStep, emptyBasics } from "./basics-step";
import { type DraftItem, initialOverrideCost, lineCost, lineNeedsCost, newItem, toDraft, toInput } from "./draft";
import { PagesStep } from "./pages-step";
import { gstValid, type Pricing, pricingTotals, PricingStep, pricingValid } from "./pricing-step";
import { ReviewStep } from "./review-step";

const STEPS = [
  { label: "Client & brief", hint: "Who is this for, and what's the brief?" },
  { label: "Budget & pages", hint: "Set the budget, then pick pages. Going over it is allowed." },
  { label: "Pricing", hint: "Set what the client is quoted, any discount, and the expected reach" },
  { label: "Review", hint: "Check the plan, then save it as a draft" },
];

const quoteOk = (v: string) => Number.isFinite(Number(v)) && Number(v) >= 0;
const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/** `assetIds`: pages ticked in Inventory ("Create plan"), added to the plan to start with. */
export type PlanFormMode = { kind: "create"; assetIds?: string[] } | { kind: "edit"; plan: Plan } | { kind: "variant"; source: Plan };

/**
 * Create / edit / variant form for a plan (design-fix, 7 Oct: the v1 wizard's
 * flow in the new design). Step 1 creates the draft and every Next saves, so
 * Close never loses a finished step. A variant is first saved on step 2 with
 * its budget and pages in one call, so an abandoned variant leaves no empty draft.
 */
export function PlanForm({ mode }: { mode: PlanFormMode }) {
  const { accessToken } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const assets = useAssets();
  const clients = useSavedClients();
  const start = mode.kind === "edit" ? mode.plan : mode.kind === "variant" ? mode.source : null;

  const [plan, setPlan] = useState<Plan | null>(mode.kind === "edit" ? mode.plan : null);
  const [step, setStep] = useState(0);
  const [basics, setBasics] = useState<Basics>(start ? basicsFromPlan(start) : emptyBasics);
  const [items, setItems] = useState<DraftItem[]>(mode.kind === "edit" ? toDraft(mode.plan) : []);
  const [budget, setBudget] = useState(mode.kind === "edit" && mode.plan.budget ? String(Number(mode.plan.budget)) : "");
  const [pricing, setPricing] = useState<Pricing>(() =>
    mode.kind === "edit"
      ? { overrideCost: initialOverrideCost(mode.plan), overrideImpressions: mode.plan.overrideImpressions != null ? String(mode.plan.overrideImpressions) : "", gstPercent: mode.plan.gstPercent != null ? String(mode.plan.gstPercent) : "", discount: mode.plan.discount ? String(Math.round(Number(mode.plan.discount))) : "" }
      : { overrideCost: "", overrideImpressions: "", gstPercent: mode.kind === "variant" ? (mode.source.gstPercent != null ? String(mode.source.gstPercent) : "") : "18", discount: "" }
  );

  const all = useMemo(() => assets.data ?? [], [assets.data]);
  const byId = useMemo(() => new Map(all.map((a) => [a.id, a])), [all]);
  // Inactive pages (admin switch) can't be added to plans; ones already on this plan stay in its selection.
  const pool = useMemo(() => all.filter((a) => a.approvalStatus === "approved" && a.isActive !== false), [all]);
  // Inventory's "Create plan" (v1 PlanWizard initialAssetIds): once the pages load, the ticked ones
  // that can go on a plan start the selection (first priced format, 1 post). The budget still caps Next.
  const seeded = useRef(false);
  const seedIds = mode.kind === "create" ? mode.assetIds : undefined;
  useEffect(() => {
    if (seeded.current || !seedIds?.length || !assets.data) return;
    seeded.current = true;
    const ids = [...new Set(seedIds)];
    const usable = ids.flatMap((id) => pool.filter((a) => a.id === id));
    setItems(usable.map(newItem));
    const left = ids.length - usable.length;
    if (left > 0) toast.info(`${left === 1 ? "1 selected page isn't" : `${left} selected pages aren't`} approved and active, so ${left === 1 ? "it was" : "they were"} left out.`);
  }, [assets.data, pool, seedIds]);
  const budgetNumber = Number(budget) > 0 ? Number(budget) : null;
  const used = items.reduce((s, i) => s + lineCost(i, byId.get(i.assetId)), 0);
  const totals = pricingTotals(items, byId, pricing);

  const saved = async (p: Plan) => {
    setPlan(p);
    await invalidateAfterPlanChange(qc);
  };

  const saveBasics = useMutation({
    mutationFn: () => {
      const b = { name: basics.name.trim(), clientName: basics.clientName.trim(), notes: basics.notes.trim() };
      if (plan)
        return plansApi.update(accessToken!, plan.id, {
          ...b,
          clientContact: basics.clientContact.trim() || null,
          clientCompany: basics.clientCompany.trim() || null,
          clientGstNumber: basics.clientGstNumber.trim() || null,
          clientAddress: basics.clientAddress.trim() || null,
        });
      return plansApi.create(accessToken!, {
        ...b,
        clientContact: basics.clientContact.trim() || undefined,
        clientCompany: basics.clientCompany.trim() || undefined,
        clientGstNumber: basics.clientGstNumber.trim() || undefined,
        clientAddress: basics.clientAddress.trim() || undefined,
        gstPercent: gstValid(pricing.gstPercent) && pricing.gstPercent.trim() ? Number(pricing.gstPercent) : null,
      });
    },
    onSuccess: async (p) => {
      await saved(p);
      setStep(1);
    },
  });

  const saveLines = useMutation({
    mutationFn: ({ withPricing }: { withPricing: boolean }) => {
      if (!plan && mode.kind === "variant") return plansApi.createVariant(accessToken!, mode.source.id, { budget: Number(budget), items: toInput(items) });
      return plansApi.update(accessToken!, plan!.id, {
        items: toInput(items),
        budget: Number(budget),
        // Lines save cost-only, so a plan that had per-line client prices keeps its quote from this save on.
        ...(!withPricing && pricing.overrideCost && quoteOk(pricing.overrideCost) ? { overrideCost: Number(pricing.overrideCost) } : {}),
        ...(withPricing
          ? {
              overrideCost: pricing.overrideCost ? Number(pricing.overrideCost) : null,
              overrideImpressions: pricing.overrideImpressions ? Number(pricing.overrideImpressions) : null,
              gstPercent: pricing.gstPercent.trim() ? Number(pricing.gstPercent) : null,
              discount: pricing.discount.trim() ? Number(pricing.discount) : null,
            }
          : {}),
      });
    },
    onSuccess: async (p, { withPricing }) => {
      await saved(p);
      setItems(toDraft(p));
      setStep(withPricing ? 3 : 2);
    },
  });

  // Last step: everything is already saved; this just lands on the plan. (The sheet's layout is
  // picked in the dialog "Client sheet" opens on the plan page, 16 Oct.)
  const finish = useMutation({
    mutationFn: async () => {},
    onSuccess: () => {
      toast.success(mode.kind === "variant" ? `${plan?.variantLabel ?? "Variant"} saved as a draft.` : mode.kind === "edit" ? "Plan saved." : `Plan “${basics.name.trim()}” saved as a draft.`);
      router.push(`/plans/${plan!.id}`);
    },
  });

  const busy = saveBasics.isPending || saveLines.isPending || finish.isPending;
  const error = saveBasics.error ?? saveLines.error ?? finish.error;
  // Over budget no longer blocks Next (16 Oct); a line with no cost does, since the server has nothing to price it with.
  const canNext = [
    mode.kind === "variant" || basicsComplete(basics),
    !!budgetNumber && items.length > 0 && !items.some((i) => lineNeedsCost(i, byId.get(i.assetId))),
    pricingValid(pricing),
    true,
  ][step];
  const exitHref = plan ? `/plans/${plan.id}` : mode.kind === "variant" ? `/plans/${mode.source.id}` : "/plans";

  function next() {
    saveBasics.reset();
    saveLines.reset();
    if (step === 0) return mode.kind === "variant" ? setStep(1) : saveBasics.mutate();
    if (step === 1) return saveLines.mutate({ withPricing: false });
    if (step === 2) return saveLines.mutate({ withPricing: true });
    finish.reset();
    finish.mutate();
  }

  const title = mode.kind === "edit" ? "Edit plan" : mode.kind === "variant" ? "New variant" : "Create plan";
  const meta =
    step === 1 ? (
      <>
        {new Set(items.map((i) => i.assetId)).size} pages · <Money value={used} />
        {budgetNumber ? (
          <>
            {" "}
            of <Money value={budgetNumber} />
          </>
        ) : null}
      </>
    ) : step >= 2 ? (
      <>
        Client pays <Money value={totals.total} />
      </>
    ) : null;

  return (
    <div className="flex flex-col gap-6 pt-1" data-testid="plan-form">
      <Link href={exitHref} className="inline-flex items-center gap-2 self-start text-body-strong text-foreground hover:text-brand-ink">
        <ArrowLeft className="h-[18px] w-[18px]" aria-hidden />
        {plan || mode.kind !== "create" ? "Back to plan" : "Back to Plans"}
      </Link>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <h1 className="text-display">{title}</h1>
          <p className="mt-1 text-body text-muted-foreground">
            {mode.kind === "variant" ? `${mode.source.name} · ${mode.source.clientName} · ` : plan ? `${plan.name} · ${plan.variantLabel} · ` : ""}
            Step {step + 1} of 4 · {STEPS[step].hint}
          </p>
        </div>
        <Button asChild variant="outline" className="ml-auto">
          <Link href={exitHref}>{plan ? "Close" : "Cancel"}</Link>
        </Button>
      </div>

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

      {step === 0 && <BasicsStep basics={basics} setBasics={setBasics} clients={clients.data ?? []} source={mode.kind === "variant" ? mode.source : undefined} />}
      {step === 1 && (
        <PagesStep
          assets={pool}
          loading={assets.isLoading}
          items={items}
          setItems={setItems}
          budget={budget}
          setBudget={setBudget}
          planId={plan?.id ?? null}
          onSheetImported={(p) => {
            void saved(p);
          }}
        />
      )}
      {step === 2 && <PricingStep items={items} byId={byId} budget={budgetNumber} pricing={pricing} setPricing={setPricing} />}
      {step === 3 && <ReviewStep basics={basics} items={items} byId={byId} budget={budgetNumber} pricing={pricing} />}

      <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center gap-3 rounded-card border bg-card px-5 py-3 shadow-2">
        {step > 0 && (
          <Button variant="ghost" disabled={busy} onClick={() => setStep((s) => s - 1)}>
            <ArrowLeft />
            Back
          </Button>
        )}
        {error && (
          <p className="text-small text-danger-helper" role="alert">
            {errText(error, "That didn't save. Try again.")}
          </p>
        )}
        <span className="ml-auto hidden text-small text-muted-foreground sm:inline">{meta}</span>
        <Button disabled={!canNext || busy} onClick={next}>
          {busy ? "Saving…" : step === 3 ? (mode.kind === "edit" ? "Done" : "Save draft plan") : `Next: ${STEPS[step + 1].label.toLowerCase()}`}
          {step < 3 && !busy && <ArrowRight />}
        </Button>
      </div>
    </div>
  );
}
