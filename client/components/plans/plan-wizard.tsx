"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Steps } from "@/components/ui/steps";
import { Button } from "@/components/ui/button";
import { ComboInput } from "@/components/ui/combo-input";
import { Field, TextField, TextArea, MoneyField, IntegerField } from "@/components/ui/form-field";
import { PageHeader } from "@/components/ui/page-header";
import { Chip, Chips } from "@/components/ui/chips";
import { Tag } from "@/components/ui/tag";
import { Note } from "@/components/ui/note";
import { Card, CardHeader, Table, THead, TH, TR, TD, Cell2 } from "@/components/ui/data-table";
import { ProgressBar } from "@/components/ui/panel";
import { ErrorNotice, EmptyState, TableSkeleton } from "@/components/ui/table-parts";
import { CloseIcon, SearchIcon, ArrowRightIcon, DownloadIcon, PlusIcon } from "@/components/icons";
import { GoogleAwareError } from "@/components/integrations/google-reconnect-notice";
import { FORMATS, comboParts, comboSplitText, isCombo, formatLabel, formatFromText, isFormat, postsPerUnit, splitCombo } from "@/lib/formats";
import { plans as plansApi, assets as assetsApi, ApiError, type Plan, type Asset, type PlanItemInput, type SheetFormat, type PageCheckResult } from "@/lib/api-client";
import { Sheet } from "@/components/ui/sheet";
import { PageCheckPanel } from "@/components/plans/page-check-panel";
import { parsePlanPageSheet } from "@/lib/parseAssignmentSheet";
import { money, compactNumber, followersLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SHEET_FORMAT_INFO, SheetFormatModal, categoryLabel, sheetFormatOf, splitByWeight } from "@/components/plans/sheet-format";
import { formatIndian } from "@/components/ui/form-field";

/**
 * Plan wizard — a full page, not a popup, in four steps (reshaped 14 Sep,
 * revised 23 Sep):
 *   1. Client & brief   — name, client, contact and a mandatory brief.
 *   2. Budget & pages   — the internal budget first, then pages by category /
 *                         search / manual pick / sheet import, posts per page,
 *                         over budget is allowed and only warned about (16 Oct).
 *   3. Pricing          — internal cost per page (read-only), the overall client
 *                         total + impressions, GST %, and budget vs our cost.
 *   4. Preview & sheet  — the client view, the client/internal Google Sheets
 *                         (one tab pair per plan in the group), and "Add another
 *                         plan" (Plan B, C…: same client, new budget + pages).
 * Pages and pricing share one draft item list held here; each "Next" persists.
 */
type StepIndex = 1 | 2 | 3 | 4;
const STEP_LABELS: Record<StepIndex, string> = { 1: "Client & brief", 2: "Budget & pages", 3: "Pricing", 4: "Preview & sheet" };
const STEP_HINT: Record<StepIndex, string> = { 1: "Who is this for, and what's the brief?", 2: "Set the budget, then pick pages — going over it is allowed, you'll see by how much", 3: "Set the overall client total, discount and expected impressions", 4: "Check the client view and generate the sheet" };

interface DraftItem {
  assetId: string;
  format: string;
  cost: string;
  postsPerProfile: string;
}

// Every line keeps its own format — all ten (14 Oct) are valid plan lines.
// A plan saved with a legacy name is read through the shared alias list
// ("carousel" → Static & Carousel), keeping its cost; anything unrecognisable
// (the server rejects it) becomes a reel with its stored cost dropped, so the
// reel rate applies instead. A legacy per-page clientCost is dropped the same
// way — the client-facing number is the overall override now (14 Sep).
const toDraft = (plan: Plan): DraftItem[] => {
  const out: DraftItem[] = [];
  for (const i of plan.items ?? []) {
    const known = isFormat(i.format) ? i.format : formatFromText(i.format);
    const line = known ? { assetId: i.assetId, format: known as string, cost: i.cost, postsPerProfile: String(i.postsPerProfile) } : { assetId: i.assetId, format: "reel", cost: "", postsPerProfile: String(i.postsPerProfile) };
    // One line per page + format (a page can have a reel and a story); two lines that read as the same format
    // (e.g. a legacy "carousel" next to a "post") merge. If their prices differ, the merged line takes the
    // posts-weighted price so the line's total stays what was saved (14 Oct review), not the first line's price.
    const same = out.find((o) => o.assetId === line.assetId && o.format === line.format);
    if (same) {
      const a = Number(same.postsPerProfile);
      const b = Number(line.postsPerProfile);
      if (same.cost && line.cost && Number(same.cost) !== Number(line.cost)) {
        const totalPaise = Math.round(Number(same.cost) * 100) * a + Math.round(Number(line.cost) * 100) * b;
        same.cost = String(Math.round(totalPaise / (a + b)) / 100);
      }
      same.postsPerProfile = String(a + b);
    } else out.push(line);
  }
  return out;
};
const toInput = (items: DraftItem[]): PlanItemInput[] =>
  items.map((i) => ({ assetId: i.assetId, format: i.format, cost: i.cost ? Number(i.cost) : undefined, postsPerProfile: Math.max(1, Number(i.postsPerProfile) || 1) }));
const rateFor = (asset: Asset | undefined, format: string) => Number(asset?.rateCards.find((rc) => rc.format === format)?.amount ?? 0);
const itemCost = (i: DraftItem, asset: Asset | undefined) => (i.cost ? Number(i.cost) : rateFor(asset, i.format));
/** Pages on a plan, not lines: a page booked in several formats is one page (16 Oct). */
const pageCount = (lines: { assetId: string }[]) => new Set(lines.map((l) => l.assetId)).size;
const itemPosts = (i: DraftItem) => Math.max(1, Number(i.postsPerProfile) || 1);
/** Posts a line produces — a combo (Reel + Story, Repost + Story) is two posts per booking (14 Oct). */
const linePosts = (i: { format: string; postsPerProfile: string | number }) => Math.max(1, Number(i.postsPerProfile) || 1) * postsPerUnit(i.format);
/** The page's priced formats, in the app's format order; all of them when it has none (each then says "no rate yet"). */
const formatsFor = (asset: Asset | undefined): string[] => {
  const priced = FORMATS.filter((f) => rateFor(asset, f) > 0);
  return priced.length > 0 ? priced : [...FORMATS];
};
/** "Reel ₹17,142.85 + Story ₹12,857.15" / "Repost ₹x + Story ₹y" — one combo's price as its two posts. */
const comboSplitLabel = (format: string, split: Record<string, number | string> | null | undefined) => comboSplitText(format, split, money);
/** A draft combo line's split from the page's part rates (same rule as the server); null for a single format. */
const draftComboSplit = (i: DraftItem, asset: Asset | undefined) => {
  const parts = comboParts(i.format);
  return parts && isCombo(i.format) ? splitCombo(i.format, itemCost(i, asset), rateFor(asset, parts[0]), rateFor(asset, parts[1])) : null;
};
const instagramUrl = (handle: string) => `https://www.instagram.com/${handle.replace(/^@/, "")}/`;

function clearableOnUpdate(value: string): string | null {
  return value.trim() === "" ? null : value;
}

export function PlanWizard({ token, plan: initialPlan, initialAssetIds, onClose, onSaved }: { token: string; plan: Plan | null; initialAssetIds: string[]; onClose: () => void; onSaved: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(initialPlan);
  const [step, setStep] = useState<StepIndex>(1);
  const [dirty, setDirty] = useState(false);

  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token) });
  const allAssets = useMemo(() => assetsQuery.data ?? [], [assetsQuery.data]);
  const assetById = useMemo(() => new Map(allAssets.map((a) => [a.id, a])), [allAssets]);

  // Draft items + budget are shared by "Budget & pages" and "Pricing".
  const [items, setItems] = useState<DraftItem[]>(() => (initialPlan && (initialPlan.items?.length ?? 0) > 0 ? toDraft(initialPlan) : []));
  const [budget, setBudget] = useState<string>(initialPlan?.budget != null ? String(Math.round(Number(initialPlan.budget))) : "");
  // Step 3's editable *overall* client numbers (user request, 14 Sep —
  // "client side overall total cost, impression should be editable, not
  // single page"). "" = no override, show the computed value.
  const [overrideCost, setOverrideCost] = useState<string>(initialPlan?.overrideCost != null ? String(Math.round(Number(initialPlan.overrideCost))) : "");
  const [overrideImpressions, setOverrideImpressions] = useState<string>(initialPlan?.overrideImpressions != null ? String(initialPlan.overrideImpressions) : "");
  // GST % — moved here from Step 1 (user request, 23 Sep: "gst input will
  // be filled on pricing section") since it's a pricing number, shown and
  // edited alongside the total cost it taxes. Still saved through the same
  // Step 2/3 "Next" mutation below; IntegerField caps it at 100.
  const [gstPercent, setGstPercent] = useState<string>(initialPlan?.gstPercent != null ? String(initialPlan.gstPercent) : "");
  // Flat discount in rupees (16 Oct), taken off the quoted total before GST. "" = none.
  const [discount, setDiscount] = useState<string>(initialPlan?.discount ? String(Math.round(Number(initialPlan.discount))) : "");
  const [seededInitial, setSeededInitial] = useState(false);
  useEffect(() => {
    if (seededInitial || initialPlan || initialAssetIds.length === 0 || allAssets.length === 0) return;
    setItems(initialAssetIds.map((assetId) => ({ assetId, format: formatsFor(assetById.get(assetId))[0], cost: "", postsPerProfile: "1" })));
    setSeededInitial(true);
  }, [seededInitial, initialPlan, initialAssetIds, allAssets, assetById]);

  function savedPlan(updated: Plan) {
    setPlan(updated);
    setDirty(true);
  }
  // "Add another plan" (23 Sep): the new sibling keeps the client details,
  // so the wizard skips Step 1 and only budget + pages are filled again.
  function startVariant(variant: Plan) {
    savedPlan(variant);
    setItems([]);
    setBudget("");
    setOverrideCost("");
    setOverrideImpressions("");
    setGstPercent(variant.gstPercent != null ? String(variant.gstPercent) : "");
    setDiscount("");
    setStep(2);
  }
  function close() {
    if (dirty) onSaved();
    onClose();
  }

  const saveItems = useMutation({
    mutationFn: () =>
      plansApi.update(token, plan!.id, {
        items: toInput(items),
        budget: Number(budget),
        overrideCost: overrideCost ? Number(overrideCost) : null,
        overrideImpressions: overrideImpressions ? Number(overrideImpressions) : null,
        gstPercent: gstPercent.trim() ? Number(gstPercent) : null,
        discount: discount.trim() ? Number(discount) : null,
      }),
    onSuccess: (saved) => {
      savedPlan(saved);
      setItems(toDraft(saved));
    },
  });

  const subtotal = items.reduce((s, i) => s + itemCost(i, assetById.get(i.assetId)) * itemPosts(i), 0);
  // Step 2 caps page-picking on the line sum; Step 3's typed total (when
  // any) is what's quoted, so pages added later never hide behind an old
  // override on the picking step.
  const computedQuoted = subtotal;
  const quoted = overrideCost ? Number(overrideCost) : computedQuoted;
  const budgetNumber = budget ? Number(budget) : null;

  return (
    <div className="flex flex-col gap-5" data-testid="plan-wizard">
      <PageHeader
        title={plan ? (plan.pitchGroupId ? `${plan.name} · ${plan.variantLabel}` : plan.name) : "New plan"}
        subtitle={`Step ${step} of 4 · ${STEP_HINT[step]}`}
        tags={plan?.status && plan.status !== "DRAFT" ? <Tag tone={plan.status === "APPROVED" ? "ok" : plan.status === "REJECTED" ? "bad" : "wait"}>{plan.status === "PENDING_APPROVAL" ? "Pending approval" : plan.status[0] + plan.status.slice(1).toLowerCase()}</Tag> : undefined}
        actions={
          <>
            <Button variant="ghost" onClick={close}>
              Save draft
            </Button>
            <Button variant="ghost" size="icon" onClick={close} aria-label="Close">
              <CloseIcon className="h-4 w-4" />
            </Button>
          </>
        }
      />

      <Steps steps={[1, 2, 3, 4].map((s) => STEP_LABELS[s as StepIndex])} current={step - 1} />

      {step === 1 && (
        <BasicsStep
          token={token}
          plan={plan}
          onSaved={(saved) => {
            savedPlan(saved);
            setStep(2);
          }}
        />
      )}

      {step === 2 && plan && (
        <PagesStep
          token={token}
          plan={plan}
          assets={allAssets}
          loading={assetsQuery.isLoading}
          items={items}
          setItems={setItems}
          budget={budget}
          setBudget={setBudget}
          quoted={computedQuoted}
          onPlanChanged={savedPlan}
          onBack={() => setStep(1)}
          saving={saveItems.isPending}
          error={saveItems.isError ? saveItems.error : null}
          onNext={() => saveItems.mutate(undefined, { onSuccess: () => setStep(3) })}
        />
      )}

      {step === 3 && plan && (
        <PriceStep
          assetById={assetById}
          items={items}
          budget={budgetNumber}
          subtotal={subtotal}
          computedQuoted={computedQuoted}
          quoted={quoted}
          overrideCost={overrideCost}
          setOverrideCost={setOverrideCost}
          overrideImpressions={overrideImpressions}
          setOverrideImpressions={setOverrideImpressions}
          gstPercent={gstPercent}
          setGstPercent={setGstPercent}
          discount={discount}
          setDiscount={setDiscount}
          onBack={() => setStep(2)}
          saving={saveItems.isPending}
          error={saveItems.isError ? saveItems.error : null}
          onNext={() => saveItems.mutate(undefined, { onSuccess: () => setStep(4) })}
        />
      )}

      {step === 4 && plan && <SendStep token={token} plan={plan} onSaved={savedPlan} onAddVariant={startVariant} onBack={() => setStep(3)} onDone={close} />}
    </div>
  );
}

function FooterBar({ onBack, meta, children }: { onBack?: () => void; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-2 flex items-center gap-2.5 border-t border-border pt-4">
      {onBack && (
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
      )}
      <span className="ml-auto hidden text-[0.8125rem] text-text-muted sm:inline">{meta}</span>
      {children}
    </div>
  );
}

/** "Budget left" bar shared by steps 2 and 3. Over budget is allowed (16 Oct) — the bar just turns red and says by how much. */
function BudgetLeft({ budget, quoted }: { budget: number | null; quoted: number }) {
  if (budget == null || !(budget > 0)) return null;
  const left = budget - quoted;
  const over = left < 0;
  return (
    <div className="flex flex-col gap-1.5" data-testid="budget-left">
      <div className="flex items-center justify-between text-[0.8125rem]">
        <span className="text-text-muted">{over ? "Over budget by" : "Budget left"}</span>
        <b className={over ? "tabular-nums text-rose" : "tabular-nums"}>{money(Math.abs(left))}</b>
      </div>
      <ProgressBar pct={(quoted / budget) * 100} tone={over ? "rose" : "accent"} />
      <p className="text-[0.72rem] text-text-faint">
        {money(quoted)} of {money(budget)} used
      </p>
    </div>
  );
}

/* ── Step 1 · Client & brief ──────────────────────────────────────────── */
function BasicsStep({ token, plan, onSaved }: { token: string; plan: Plan | null; onSaved: (plan: Plan) => void }) {
  const [name, setName] = useState(plan?.name ?? "");
  const [clientName, setClientName] = useState(plan?.clientName ?? "");
  // Saved clients (21 Sep) — suggesting earlier names keeps a repeat client
  // spelled the same way, which is what lets the "Generate invoice" popup
  // find and fill in their GST/address later. One suggestion per name here,
  // however many billing profiles sit under it.
  const clientsQuery = useQuery({ queryKey: ["plans", "clients"], queryFn: () => plansApi.clients(token) });
  const savedClients = clientsQuery.data ?? [];
  const nameSuggestions = [...new Map(savedClients.map((c) => [c.clientName.toLowerCase(), c])).values()].map((c) => ({
    key: c.clientName.toLowerCase(),
    label: c.clientName,
    hint: savedClients.some((o) => o.clientName.toLowerCase() === c.clientName.toLowerCase() && (o.clientGstNumber || o.clientCompany)) ? "Billing details saved" : undefined,
  }));
  const knownProfiles = savedClients.filter((c) => c.clientName.toLowerCase() === clientName.trim().toLowerCase() && (c.clientGstNumber || c.clientCompany || c.clientAddress));
  const [clientContact, setClientContact] = useState(plan?.clientContact ?? "");
  const [notes, setNotes] = useState(plan?.notes ?? "");

  const mutation = useMutation({
    mutationFn: () =>
      plan
        ? plansApi.update(token, plan.id, { name, clientName, clientContact: clearableOnUpdate(clientContact ?? ""), notes: notes.trim() })
        : plansApi.create(token, { name, clientName, clientContact: clientContact || undefined, notes: notes.trim() }),
    onSuccess: onSaved,
  });
  const ready = Boolean(name.trim() && clientName.trim() && notes.trim());

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) mutation.mutate();
      }}
      className="flex flex-col gap-5"
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <Card className="p-5 md:p-6">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Plan name">
                <TextField required aria-label="Plan name" value={name} onChange={setName} placeholder="e.g. Nykaa Summer pitch" />
              </Field>
              <Field label="Client name">
                <ComboInput required aria-label="Client name" value={clientName} onChange={setClientName} suggestions={nameSuggestions} placeholder="e.g. Nykaa" />
                {knownProfiles.length > 0 && (
                  <p className="text-[0.72rem] text-text-faint" data-testid="plan-known-client-note">
                    {knownProfiles.length === 1
                      ? `Saved client — ${[knownProfiles[0].clientCompany, knownProfiles[0].clientGstNumber].filter(Boolean).join(" · ")}. These details fill in automatically when you generate the invoice.`
                      : `Saved client with ${knownProfiles.length} billing profiles — you'll pick one when you generate the invoice.`}
                  </p>
                )}
              </Field>
            </div>
            <Field label="Client contact (optional)">
              <TextField aria-label="Client contact" value={clientContact ?? ""} onChange={setClientContact} placeholder="Email or phone" />
            </Field>
            {/* user request, 14 Sep — "brief note will be mandatory" */}
            <Field label="Brief">
              <TextArea required aria-label="Brief" value={notes ?? ""} onChange={setNotes} placeholder="What the client wants from this campaign — goals, tone, must-haves, timing." rows={4} />
            </Field>
          </div>
        </Card>
        <Note tone="info" className="self-start">
          The budget is set on the next step. The client's own GST number, company and billing address are asked for when the client invoice is generated.
        </Note>
      </div>
      {mutation.isError && <ErrorNotice message={mutation.error instanceof ApiError ? mutation.error.message : "Couldn't save this plan."} />}
      <FooterBar>
        <Button type="submit" disabled={mutation.isPending || !ready}>
          {mutation.isPending ? "Saving…" : "Next: Budget & pages"} <ArrowRightIcon className="h-4 w-4" />
        </Button>
      </FooterBar>
    </form>
  );
}

/* ── Step 2 · Budget & pages ──────────────────────────────────────────── */
function PagesStep({
  token,
  plan,
  assets,
  loading,
  items,
  setItems,
  budget,
  setBudget,
  quoted,
  onPlanChanged,
  onBack,
  onNext,
  saving,
  error,
}: {
  token: string;
  plan: Plan;
  assets: Asset[];
  loading: boolean;
  items: DraftItem[];
  setItems: React.Dispatch<React.SetStateAction<DraftItem[]>>;
  budget: string;
  setBudget: (v: string) => void;
  quoted: number;
  onPlanChanged: (p: Plan) => void;
  onBack: () => void;
  onNext: () => void;
  saving: boolean;
  error: unknown;
}) {
  const queryClient = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [topN, setTopN] = useState("10");
  const [sheetLink, setSheetLink] = useState("");
  const [sheetFileName, setSheetFileName] = useState("");
  const [sheetError, setSheetError] = useState("");
  const [sheetResultMsg, setSheetResultMsg] = useState("");
  const [capMessage, setCapMessage] = useState("");

  const budgetNumber = budget ? Number(budget) : null;
  const hasBudget = budgetNumber != null && budgetNumber > 0;
  const overBudget = hasBudget && quoted > budgetNumber;
  // Lines for a format the page has no rate for, with no cost typed yet — the server would refuse them (NO_RATE_CARD).
  const linesWithoutCost = items.filter((i) => !(itemCost(i, assets.find((a) => a.id === i.assetId)) > 0)).length;

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assets) if (a.category) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
    return [{ label: "All", count: assets.length }, ...[...counts.entries()].map(([label, c]) => ({ label, count: c }))];
  }, [assets]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...assets]
      // Inactive pages (admin switch, 8 Oct) can't be added; one already on this plan stays listed.
      .filter((a) => a.isActive !== false || items.some((i) => i.assetId === a.id))
      .filter((a) => categoryFilter === "All" || a.category === categoryFilter)
      .filter((a) => !q || a.handle.toLowerCase().includes(q) || (a.category ?? "").toLowerCase().includes(q))
      .sort((a, b) => b.followers - a.followers);
  }, [assets, categoryFilter, search, items]);
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  // A page can carry one line per format (8 Oct — "option of selecting both story and reel").
  const itemByAsset = new Map(items.map((i) => [i.assetId, i]));
  const linesOf = (assetId: string) => items.filter((i) => i.assetId === assetId);
  const lineOf = (assetId: string, format: string) => items.find((i) => i.assetId === assetId && i.format === format);

  const newItem = (asset: Asset): DraftItem => ({ assetId: asset.id, format: formatsFor(asset)[0], cost: "", postsPerProfile: "1" });
  const costToAdd = (asset: Asset) => rateFor(asset, formatsFor(asset)[0]);

  // Hard cap (user request, 14 Sep, decided this session): a page that
  // doesn't fit in what's left can't be added, and posts can't be raised
  // past it. Removing is always allowed.
  function toggleAsset(asset: Asset) {
    setCapMessage("");
    if (itemByAsset.has(asset.id)) {
      setItems((prev) => prev.filter((i) => i.assetId !== asset.id));
      return;
    }
    if (!hasBudget) return setCapMessage("Enter the budget first — pages are picked against it.");
    // Going over the budget is allowed (16 Oct) — the "Over budget by" bar says so; nothing blocks here.
    // A page with no rates can still be picked (16 Oct): its cost is typed on the line.
    if (!(costToAdd(asset) > 0)) setCapMessage(`@${asset.handle} has no rates yet — type the ${formatLabel(newItem(asset).format)} cost on its line.`);
    setItems((prev) => [...prev, newItem(asset)]);
  }
  function updateItem(assetId: string, format: string, patch: Partial<DraftItem>) {
    setCapMessage("");
    const current = lineOf(assetId, format);
    if (!current) return;
    const next = { ...current, ...patch };
    setItems((prev) => prev.map((i) => (i === current ? next : i)));
  }
  /** Turns a format on for a picked page (a new line, within the budget) or off (it keeps at least one). */
  function toggleFormat(asset: Asset, format: string) {
    setCapMessage("");
    const existing = lineOf(asset.id, format);
    if (existing) {
      if (linesOf(asset.id).length === 1) return setCapMessage(`@${asset.handle} needs at least one format — untick the page to remove it.`);
      setItems((prev) => prev.filter((i) => i !== existing));
      return;
    }
    const cost = rateFor(asset, format);
    // Any format can be added (16 Oct); one with no rate on the page needs its cost typed on the line.
    if (!(cost > 0)) setCapMessage(`@${asset.handle} has no ${formatLabel(format)} rate — type its cost on the line.`);
    setItems((prev) => [...prev, { assetId: asset.id, format, cost: "", postsPerProfile: "1" }]);
  }
  function addTopN() {
    setCapMessage("");
    if (!hasBudget) return setCapMessage("Enter the budget first — pages are picked against it.");
    const n = Math.max(1, Number(topN) || 0);
    // Every candidate is added (16 Oct — over budget is allowed); pages with no rate yet need a typed cost.
    const candidates = visible.filter((a) => !itemByAsset.has(a.id)).slice(0, n);
    const unpriced = candidates.filter((a) => !(costToAdd(a) > 0)).length;
    if (unpriced > 0) setCapMessage(`${unpriced} of ${candidates.length} added pages have no rate — type their cost on the line.`);
    setItems((prev) => [...prev, ...candidates.map(newItem)]);
  }

  const importMutation = useMutation({
    mutationFn: async (url: string) => {
      const { csv } = await plansApi.importSheetUrl(token, url);
      return parsePlanPageSheet(csv);
    },
    onSuccess: (rows) => importRows(rows),
    onError: (err) => setSheetError(err instanceof ApiError ? err.message : "Couldn't fetch that sheet."),
  });
  const attachRowsMutation = useMutation({
    mutationFn: (rows: Awaited<ReturnType<typeof parsePlanPageSheet>>) => plansApi.importSheetPages(token, plan.id, rows),
    onSuccess: (result) => {
      const needsCost = result.needsCost ?? [];
      setSheetResultMsg(
        `${result.matchedCount} matched, ${result.createdCount} new page${result.createdCount === 1 ? "" : "s"} created.` +
          (needsCost.length > 0 ? ` ${needsCost.length} line${needsCost.length === 1 ? " has" : "s have"} no cost in the sheet — type ${needsCost.length === 1 ? "it" : "them"} on the line${needsCost.length === 1 ? "" : "s"} below.` : "")
      );
      if (result.failures.length > 0) setSheetError(result.failures.map((f) => `@${f.handle}: ${f.reason}`).join(" "));
      const serverItems = toDraft(result.plan);
      const key = (i: DraftItem) => `${i.assetId}:${i.format}`;
      const serverIds = new Set(serverItems.map(key));
      // Sheet rows without a cost come in as lines with an empty cost box (16 Oct — "if not filled can add up later").
      const blankCost: DraftItem[] = needsCost.map((n) => ({ assetId: n.assetId, format: n.format, cost: "", postsPerProfile: String(n.postsPerProfile) }));
      setItems((prevLocal) => {
        const kept = prevLocal.filter((i) => !serverIds.has(key(i)));
        const keptIds = new Set(kept.map(key));
        return [...serverItems, ...kept, ...blankCost.filter((b) => !serverIds.has(key(b)) && !keptIds.has(key(b)))];
      });
      onPlanChanged(result.plan);
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (err) => setSheetError(err instanceof ApiError ? err.message : "Couldn't import that sheet."),
  });
  async function importRows(rows: Awaited<ReturnType<typeof parsePlanPageSheet>>) {
    setSheetError("");
    setSheetResultMsg("");
    if (rows.length === 0) {
      setSheetError('No rows found — check the sheet has a header row (e.g. "handle").');
      return;
    }
    attachRowsMutation.mutate(rows);
  }
  async function handleSheetFile(file: File | undefined) {
    if (!file) return;
    setSheetFileName(file.name);
    setSheetError("");
    try {
      await importRows(await parsePlanPageSheet(file));
    } catch {
      setSheetError("Couldn't read that file — make sure it's a CSV export.");
    }
  }

  const maxPosts = items.reduce((m, i) => Math.max(m, itemPosts(i)), 1);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Budget comes first (user request, 14 Sep — "after this, budget
              selection, according to the budget can add no. of post per page"). */}
          <Card className="p-[18px]" data-testid="budget-card">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="sm:w-[260px]">
                {/* Was "Client budget" — always was our own internal cost
                    cap (it bounds `subtotal`, not the client-facing quote),
                    relabeled 23 Sep to say so plainly. */}
                <Field label="Internal budget">
                  <MoneyField aria-label="Budget" value={budget} onChange={setBudget} placeholder="4,50,000" />
                </Field>
              </div>
              <p className="text-[0.75rem] text-text-muted sm:max-w-[360px] sm:text-right">Pages and posts can be added only up to this amount. Change it here any time.</p>
            </div>
          </Card>

          <Card className="flex flex-col">
            <CardHeader
              title="Pick pages"
              meta={<span className="text-[0.78rem] text-text-muted">{pageCount(items)} selected</span>}
              action={
                <label className="relative block w-[200px]">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search pages" aria-label="Search pages" className="h-8 w-full rounded-md border border-border bg-surface pl-8 pr-2 text-[0.78rem] placeholder:text-text-faint focus:border-ink focus:outline-none" />
                </label>
              }
            />
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-[18px] py-2.5">
              <Chips className="min-w-0 flex-1">
                {categories.map((c) => (
                  <Chip key={c.label} on={categoryFilter === c.label} count={c.count} onClick={() => setCategoryFilter(c.label)}>
                    {c.label}
                  </Chip>
                ))}
              </Chips>
              <div className="flex items-center gap-1.5 text-[0.75rem] text-text-muted">
                Add top
                <IntegerField value={topN} onChange={setTopN} max={500} aria-label="How many top pages to add" className="h-7 w-14 rounded-[6px] px-2 text-center text-[0.78rem] shadow-none" />
                by followers
                <Button type="button" size="sm" variant="secondary" onClick={addTopN}>
                  Add
                </Button>
              </div>
            </div>
            {capMessage && (
              <p className="border-b border-border bg-rose-soft px-[18px] py-2 text-[0.78rem] text-rose" role="status" data-testid="budget-cap-message">
                {capMessage}
              </p>
            )}
            {loading ? (
              <TableSkeleton />
            ) : visible.length === 0 ? (
              <EmptyState label="No pages in this category." />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH className="w-9 pr-0" />
                    <TH>Page</TH>
                    <TH className="hidden 2xl:table-cell">Category</TH>
                    <TH right className="hidden sm:table-cell">
                      Followers
                    </TH>
                    <TH>Format</TH>
                    <TH right>Cost</TH>
                    <TH>Posts × cost / post</TH>
                  </tr>
                </THead>
                <tbody>
                  {visible.map((asset) => {
                    const item = itemByAsset.get(asset.id);
                    // Shown in the app's format order, whatever order they were picked in.
                    const lines = linesOf(asset.id).sort((a, b) => FORMATS.indexOf(a.format as (typeof FORMATS)[number]) - FORMATS.indexOf(b.format as (typeof FORMATS)[number]));
                    const selected = Boolean(item);
                    // Every format is offered (16 Oct — "option of adding all … can select multiple") from one
                    // dropdown (14 Oct — "give format dropdown"); unpriced ones say "no rate" and need a typed cost.
                    const formatOptions = FORMATS.map((f) => {
                      const rate = rateFor(asset, f);
                      return { value: f, label: formatLabel(f), hint: rate > 0 ? money(rate) : "no rate", muted: !(rate > 0) };
                    });
                    const fits = selected || hasBudget;
                    const rowTotal = lines.reduce((sum, l) => sum + itemCost(l, asset) * itemPosts(l), 0);
                    return (
                      <TR key={asset.id} selected={selected}>
                        <TD className="w-9 pr-0">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleAsset(asset)}
                            disabled={!fits}
                            title={!fits ? "Enter the budget first" : undefined}
                            aria-label={`Select @${asset.handle}`}
                            className="h-4 w-4 rounded accent-[var(--ink)] disabled:opacity-40"
                          />
                        </TD>
                        <TD>
                          {/* user request, 14 Sep — "instagram page link should be open on clicking page name" */}
                          <a href={instagramUrl(asset.handle)} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-semibold hover:text-blue hover:underline" title={`Open @${asset.handle} on Instagram`}>
                            @{asset.handle}
                          </a>
                        </TD>
                        <TD className="hidden 2xl:table-cell">{asset.category ? <Tag tone="neutral" dot={false}>{asset.category}</Tag> : <span className="text-text-faint">—</span>}</TD>
                        <TD right className="hidden whitespace-nowrap tabular-nums text-text-muted sm:table-cell">
                          {followersLabel(asset.followers)} followers
                        </TD>
                        <TD>
                          {selected && item ? (
                            // Pick a format to add it as a line (16 Oct — same "select a format, then its rate" control as Inventory);
                            // the lines themselves sit stacked in the last column, each with its own remove button.
                            <select
                              value=""
                              onChange={(e) => e.target.value && toggleFormat(asset, e.target.value)}
                              aria-label={`Add a format for @${asset.handle}`}
                              className="h-8 max-w-[11rem] rounded-[6px] border border-border bg-surface px-2 text-[0.78rem] text-text focus:border-ink focus:outline-none"
                              data-testid={`plan-add-format-${asset.id}`}
                            >
                              <option value="">{lines.length === 0 ? "Add format…" : `+ Add format (${lines.length} picked)`}</option>
                              {formatOptions
                                .filter((o) => !lines.some((l) => l.format === o.value))
                                .map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label} · {o.hint}
                                  </option>
                                ))}
                            </select>
                          ) : (
                            <span className="text-text-faint">—</span>
                          )}
                        </TD>
                        <TD right className="whitespace-nowrap tabular-nums">
                          {selected && item ? (
                            <span className="font-semibold" data-testid={`plan-row-total-${asset.id}`} title="Posts × cost per post, all formats">
                              {money(rowTotal)}
                            </span>
                          ) : costToAdd(asset) ? (
                            money(costToAdd(asset))
                          ) : (
                            <span className="text-text-faint">—</span>
                          )}
                        </TD>
                        <TD>
                          {selected && item ? (
                            // One line per picked format, stacked (16 Oct): posts × cost per post, and a remove button.
                            // Blank cost = the page's rate.
                            <div className="flex flex-col items-start gap-1.5" data-testid={`plan-lines-${asset.id}`}>
                              {lines.map((l) => {
                                const rate = rateFor(asset, l.format);
                                const needsCost = !(itemCost(l, asset) > 0);
                                const split = needsCost ? null : draftComboSplit(l, asset);
                                return (
                                  <div
                                    key={l.format}
                                    className={cn("flex shrink-0 items-center gap-1.5 rounded-md border bg-surface-2 py-1 pl-2 pr-1", needsCost ? "border-rose" : "border-border")}
                                    data-testid={`plan-line-${asset.id}-${l.format}`}
                                    title={needsCost ? `No ${formatLabel(l.format)} rate on the page — type a ${formatLabel(l.format)} cost` : undefined}
                                  >
                                    <span className="whitespace-nowrap text-[0.72rem] font-medium text-text-2">{formatLabel(l.format)}</span>
                                    <IntegerField value={l.postsPerProfile} onChange={(v) => updateItem(asset.id, l.format, { postsPerProfile: v })} max={99} aria-label={`${formatLabel(l.format)} posts for @${asset.handle}`} className="h-8 w-12 rounded-[6px] px-2 text-[0.78rem] shadow-none" />
                                    <span className="text-[0.72rem] text-text-faint">×</span>
                                    <MoneyField
                                      compact
                                      value={l.cost}
                                      onChange={(v) => updateItem(asset.id, l.format, { cost: v })}
                                      placeholder={rate > 0 ? formatIndian(String(rate)) : "Cost"}
                                      aria-label={`${formatLabel(l.format)} cost for @${asset.handle}`}
                                      aria-invalid={needsCost || undefined}
                                      className={cn("w-24", needsCost && "[&_input]:border-rose")}
                                    />
                                    {split && (
                                      <span className="whitespace-nowrap pr-1 text-[0.68rem] text-text-faint" data-testid={`combo-split-${asset.id}-${l.format}`}>
                                        {comboSplitLabel(l.format, split)} each
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => toggleFormat(asset, l.format)}
                                      aria-label={`Remove ${formatLabel(l.format)} for @${asset.handle}`}
                                      title={lines.length === 1 ? "Untick the page to remove its last format" : `Remove ${formatLabel(l.format)}`}
                                      className="flex h-6 w-6 items-center justify-center rounded-[5px] text-text-faint hover:bg-surface hover:text-text"
                                    >
                                      <CloseIcon className="h-3 w-3" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-text-faint">—</span>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2 p-[18px]">
            <div className="flex items-center justify-between text-[0.8125rem]">
              <span className="text-text-muted">Pages selected</span>
              <b className="tabular-nums">{new Set(items.map((i) => i.assetId)).size}</b>
            </div>
            <div className="flex items-center justify-between text-[0.8125rem]">
              <span className="text-text-muted">Our cost so far</span>
              <b className="tabular-nums">{money(quoted)}</b>
            </div>
            {hasBudget ? <BudgetLeft budget={budgetNumber} quoted={quoted} /> : <p className="text-[0.75rem] text-text-faint">Enter a budget to start picking pages.</p>}
            {overBudget && (
              <Note tone="warn" className="text-[0.75rem]">
                <span data-testid="over-budget-warning">Over budget by {money(quoted - budgetNumber)}. You can carry on — the plan will show it as over budget.</span>
              </Note>
            )}
            {/* "Are these pages still up?" (17 Oct) — checked on Instagram (24h cache), with a swap for any that aren't. */}
            {items.length > 0 && (
              <PageCheckPanel
                token={token}
                assets={assets}
                pickedIds={[...new Set(items.map((i) => i.assetId))]}
                onReplace={(oldId, replacement) => {
                  setCapMessage("");
                  setItems((prev) => {
                    const moved = prev.filter((i) => i.assetId === oldId).map((i) => ({ ...i, assetId: replacement.id, cost: "" }));
                    const rest = prev.filter((i) => i.assetId !== oldId);
                    // The replacement may already be on the plan: keep its lines, add only the formats it lacks.
                    const have = new Set(rest.filter((i) => i.assetId === replacement.id).map((i) => i.format));
                    return [...rest, ...moved.filter((i) => !have.has(i.format))];
                  });
                  queryClient.invalidateQueries({ queryKey: ["assets"] });
                }}
              />
            )}
            {maxPosts > 1 && (
              <p className="border-t border-border pt-2 text-[0.72rem] text-text-muted">
                Pages with more than one post run as phases — creators will see this as {maxPosts} campaigns (Phase 1 to {maxPosts}).
              </p>
            )}
          </Card>
          <Card className="p-[18px]">
            <p className="text-[0.8375rem] font-semibold">Attach a Google Sheet of pages (optional)</p>
            <p className="mt-1 text-[0.78rem] text-text-muted">Columns: Handle, Format (Reel, Entertainment / Brand, PR, Political, Static &amp; Carousel, Repost, Story, Political Story, Reel + Story or Repost + Story), Cost and Posts. A handle not already in Inventory is added as a new pending page. A row with no cost (and no rate on the page) still comes in — type its cost on the line before moving on.</p>
            <div className="mt-3 flex flex-col gap-2">
              <TextField type="url" value={sheetLink} onChange={setSheetLink} placeholder="https://docs.google.com/spreadsheets/…" />
              <Button type="button" variant="secondary" disabled={!sheetLink.trim() || importMutation.isPending || attachRowsMutation.isPending} onClick={() => importMutation.mutate(sheetLink)}>
                {importMutation.isPending || attachRowsMutation.isPending ? "Fetching…" : "Fetch & attach"}
              </Button>
              <label className="flex h-[64px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-border-strong text-[0.78rem] font-medium text-text-muted hover:bg-surface-2">
                <DownloadIcon className="h-4 w-4" />
                {sheetFileName || "…or upload a CSV of pages instead"}
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => handleSheetFile(e.target.files?.[0])} />
              </label>
              {sheetError && <p className="text-[0.75rem] text-rose">{sheetError}</p>}
              {sheetResultMsg && !sheetError && <p className="text-[0.75rem] text-accent">{sheetResultMsg}</p>}
            </div>
          </Card>
        </div>
      </div>
      {error ? <ErrorNotice message={error instanceof ApiError ? error.message : "Couldn't save these pages."} /> : null}
      <FooterBar onBack={onBack} meta={`${pageCount(items)} page${pageCount(items) === 1 ? "" : "s"} · ${money(quoted)}${hasBudget ? ` of ${money(budgetNumber)}` : ""}`}>
        <Button
          type="button"
          onClick={onNext}
          disabled={saving || !hasBudget || linesWithoutCost > 0}
          title={!hasBudget ? "Enter the budget first" : linesWithoutCost > 0 ? "Type a cost for every format that has no rate" : undefined}
        >
          {saving ? "Saving…" : "Next: Pricing"} <ArrowRightIcon className="h-4 w-4" />
        </Button>
      </FooterBar>
    </div>
  );
}

/* ── Step 3 · Pricing ─────────────────────────────────────────────────── */
function PriceStep({
  assetById,
  items,
  budget,
  subtotal,
  computedQuoted,
  quoted,
  overrideCost,
  setOverrideCost,
  overrideImpressions,
  setOverrideImpressions,
  gstPercent,
  setGstPercent,
  discount,
  setDiscount,
  onBack,
  onNext,
  saving,
  error,
}: {
  assetById: Map<string, Asset>;
  items: DraftItem[];
  budget: number | null;
  subtotal: number;
  /** Sum of the lines (cost × posts) — the "Total cost" placeholder when nothing's typed. */
  computedQuoted: number;
  /** The client-facing total in effect: the typed override, else computedQuoted. */
  quoted: number;
  overrideCost: string;
  setOverrideCost: (v: string) => void;
  overrideImpressions: string;
  setOverrideImpressions: (v: string) => void;
  /** GST % (user request, 23 Sep — moved here from Step 1, the pricing step it actually taxes). "" = no GST line. */
  gstPercent: string;
  setGstPercent: (v: string) => void;
  /** Flat discount in rupees (16 Oct), off the quoted total before GST. "" = none. */
  discount: string;
  setDiscount: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
  saving: boolean;
  error: unknown;
}) {
  // The quoted total is a markup and may exceed the budget. Nothing here blocks Next.
  const belowComputed = Boolean(overrideCost) && quoted < computedQuoted;
  const markup = quoted - subtotal;
  // Mirrors the server's annotatePlan: discount first (floored at 0), then GST
  // on what's left, rounded to paise so this preview matches the saved overview.
  const discountNum = discount.trim() ? Number(discount) : 0;
  const taxable = Math.max(0, quoted - discountNum);
  const gstPercentNum = gstPercent.trim() ? Number(gstPercent) : null;
  const gstAmount = gstPercentNum ? Math.round(taxable * (gstPercentNum / 100) * 100) / 100 : 0;
  const totalWithGst = taxable + gstAmount;
  const computedViews = items.reduce((s, i) => s + (assetById.get(i.assetId)?.engagement.avgViews ?? 0) * linePosts(i), 0);
  const expectedViews = overrideImpressions ? Number(overrideImpressions) : computedViews;
  const cpm = expectedViews > 0 ? (quoted / expectedViews) * 1000 : null;
  const categories = [...new Set(items.map((i) => assetById.get(i.assetId)?.category).filter(Boolean))].join(", ");

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title={`${pageCount(items)} page${pageCount(items) === 1 ? "" : "s"}${categories ? ` · ${categories}` : ""}`} meta={<span className="text-[0.78rem] text-text-muted">our cost is what each page earns; the client total is set on the right</span>} />
          {items.length === 0 ? (
            <EmptyState label="No pages picked yet — go back and select some." />
          ) : (
            <Table data-testid="price-table">
              <THead>
                <tr>
                  <TH>Page</TH>
                  <TH right className="hidden sm:table-cell">
                    Followers
                  </TH>
                  <TH right className="hidden md:table-cell">
                    Exp. impressions
                  </TH>
                  <TH right>Our cost</TH>
                </tr>
              </THead>
              <tbody>
                {items.map((i) => {
                  const asset = assetById.get(i.assetId);
                  const ours = itemCost(i, asset);
                  const posts = itemPosts(i);
                  const totalPosts = linePosts(i);
                  return (
                    <TR key={`${i.assetId}:${i.format}`}>
                      <TD>
                        <Cell2
                          primary={`@${asset?.handle ?? "—"}`}
                          secondary={`${formatLabel(i.format)}${totalPosts > 1 ? ` · ${totalPosts} posts` : ""}${isCombo(i.format) ? ` · ${comboSplitLabel(i.format, draftComboSplit(i, asset))}` : ""}`}
                        />
                      </TD>
                      <TD right className="hidden tabular-nums text-text-muted sm:table-cell">
                        {asset ? followersLabel(asset.followers) : "—"}
                      </TD>
                      <TD right className="hidden tabular-nums text-text-muted md:table-cell">
                        {asset?.engagement.avgViews != null ? compactNumber(asset.engagement.avgViews * totalPosts) : "—"}
                      </TD>
                      <TD right className="tabular-nums text-text-muted" data-testid={`internal-cost-${i.assetId}`}>
                        {money(ours)}
                        {posts > 1 && <span className="ml-1 text-[0.72rem] text-text-faint">× {posts}</span>}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2.5 p-[18px]" data-testid="price-totals">
            <b className="text-[0.875rem]">Client side</b>
            <EditableRow label="Total cost" hint={`computed ${money(computedQuoted)}`}>
              <MoneyField compact value={overrideCost} onChange={setOverrideCost} placeholder={formatIndian(String(Math.round(computedQuoted)))} aria-label="Total cost to client" className="ml-auto w-36" />
            </EditableRow>
            <EditableRow label="Expected impressions" hint={`computed ${computedViews > 0 ? compactNumber(computedViews) : "—"}`}>
              <IntegerField value={overrideImpressions} onChange={setOverrideImpressions} placeholder={computedViews > 0 ? formatIndian(String(Math.round(computedViews))) : "0"} aria-label="Expected impressions" className="ml-auto h-8 w-36 text-right" />
            </EditableRow>
            <p className="text-[0.72rem] text-text-faint">Leave blank to use the computed number. These are what the client sees.</p>
            {belowComputed && (
              <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[0.75rem] text-amber-800" data-testid="override-below-computed">
                Below what the pages come to ({money(computedQuoted)}) — the client would pay less than the pages earn.
              </p>
            )}
            <Row label="Quoted to client" value={money(quoted)} bold />
            <EditableRow label="Discount" hint="Optional — a flat amount off, before GST">
              <MoneyField compact value={discount} onChange={setDiscount} placeholder="0" aria-label="Discount" className="ml-auto w-36" />
            </EditableRow>
            {discountNum > 0 && (
              <>
                {discountNum > quoted && (
                  <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[0.75rem] text-amber-800" data-testid="discount-over-quoted">
                    The discount is more than the quoted total — the client would pay nothing.
                  </p>
                )}
                <Row label="After discount" value={money(taxable)} bold />
              </>
            )}
            <EditableRow label="GST %" hint={discountNum > 0 ? "Optional — applied after the discount" : "Optional — applied to the quoted total above"}>
              <IntegerField value={gstPercent} onChange={setGstPercent} max={100} placeholder="e.g. 18" aria-label="GST percent" className="ml-auto h-8 w-20 text-right" />
            </EditableRow>
            {gstPercentNum != null && (
              <>
                <Row label={`GST (${gstPercentNum}%)`} value={money(gstAmount)} />
                <Row label="Total incl. GST" value={money(totalWithGst)} bold />
              </>
            )}
            <div className="my-0.5 h-px bg-border" />
            <b className="text-[0.875rem]">Internal</b>
            {/* Moved off "Client side" (23 Sep) — it always was our own cap, not something the client sees. */}
            <Row label="Budget" value={budget != null ? money(budget) : "—"} />
            <Row label="Our cost" value={money(subtotal)} />
            <Row label={markup >= 0 ? "Margin" : "Loss"} value={money(Math.abs(markup))} tone={markup > 0 ? "ok" : markup < 0 ? "bad" : undefined} />
            <BudgetLeft budget={budget} quoted={subtotal} />
          </Card>
          <Card className="flex flex-col gap-2.5 p-[18px]">
            <b className="text-[0.875rem]">Expected reach</b>
            <Row label="Expected impressions" value={expectedViews > 0 ? compactNumber(expectedViews) : "—"} bold />
            <Row label="Cost per 1k impressions" value={cpm != null ? money(Math.round(cpm)) : "—"} bold />
            <p className="text-[0.75rem] text-text-muted">{overrideImpressions ? "Using the impressions you entered." : "Based on each page\u2019s scraped average views."}</p>
          </Card>
        </div>
      </div>
      {error ? <ErrorNotice message={error instanceof ApiError ? error.message : "Couldn't save the pricing."} /> : null}
      <FooterBar onBack={onBack} meta={`Quoted ${money(quoted)} · pages ${money(subtotal)}${budget != null ? ` of ${money(budget)}` : ""}`}>
        <Button type="button" onClick={onNext} disabled={saving}>
          {saving ? "Saving…" : "Next: Preview"} <ArrowRightIcon className="h-4 w-4" />
        </Button>
      </FooterBar>
    </div>
  );
}

function EditableRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[0.8125rem]">
      <span className="flex flex-col">
        <span className="text-text-muted">{label}</span>
        <span className="text-[0.7rem] text-text-faint">{hint}</span>
      </span>
      {children}
    </div>
  );
}

function Row({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: "ok" | "bad" }) {
  return (
    <div className="flex items-center justify-between text-[0.8125rem]">
      <span className="text-text-muted">{label}</span>
      <span className={`tabular-nums ${bold ? "font-semibold" : ""} ${tone === "bad" ? "text-rose" : tone === "ok" ? "text-accent" : ""}`}>{value}</span>
    </div>
  );
}

/* ── Step 4 · Preview & sheet ─────────────────────────────────────────── */
function SendStep({
  token,
  plan,
  onSaved,
  onAddVariant,
  onBack,
  onDone,
}: {
  token: string;
  plan: Plan;
  onSaved: (plan: Plan) => void;
  onAddVariant: (variant: Plan) => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const variantMutation = useMutation({ mutationFn: () => plansApi.createVariant(token, plan.id), onSuccess: onAddVariant });
  const [share, setShare] = useState<{ sharedWith?: string; shareError?: string } | null>(null);
  // "Client sheet" opens the format popup first (16 Oct); the pick travels with the generate call.
  const [pickingFormat, setPickingFormat] = useState(false);
  const generateMutation = useMutation({
    mutationFn: async ({ variant, sheetFormat }: { variant: "client" | "internal"; sheetFormat?: SheetFormat }) => {
      const result = await plansApi.generateSheet(token, plan.id, variant, sheetFormat);
      setShare(result);
      return plansApi.get(token, plan.id);
    },
    onMutate: () => setShare(null),
    onSuccess: (saved) => {
      setPickingFormat(false);
      onSaved(saved);
    },
  });
  const pendingVariant = generateMutation.isPending ? generateMutation.variables?.variant : null;
  const format = sheetFormatOf(plan);
  const inactivePages = plan.inactivePages ?? [];
  // Pages by category, biggest audience first — the sheet's own tabs.
  const groups = (() => {
    // Case-insensitive, like the sheet's tabs ("news" and "NEWS" are one category).
    const byKey = new Map<string, { label: string; items: Plan["items"] }>();
    for (const item of plan.items) {
      const label = categoryLabel(item.asset?.category);
      const g = byKey.get(label.toLowerCase()) ?? { label, items: [] };
      g.items.push(item);
      byKey.set(label.toLowerCase(), g);
    }
    const followersOf = (items: Plan["items"]) => [...new Map(items.map((i) => [i.assetId, i.asset?.followers ?? 0])).values()].reduce((a, b) => a + b, 0);
    return [...byKey.values()].map(({ label, items }) => ({ label, items, followers: followersOf(items) })).sort((a, b) => b.followers - a.followers);
  })();
  const categoryCosts = splitByWeight(
    plan.overview.subtotal,
    groups.map((g) => g.items.reduce((sum, i) => sum + Number(i.clientCost ?? i.cost) * i.postsPerProfile, 0))
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
        <Card className="overflow-hidden">
          <CardHeader title="Client sheet preview" meta={<span className="text-[0.78rem] text-text-muted">what the client will see</span>} />
          <div className="bg-surface-2 p-4 md:p-6">
            <div className="mx-auto flex max-w-[560px] flex-col gap-4 rounded-[6px] border border-border bg-surface p-5 shadow-lg">
              <p className="text-[0.72rem] font-semibold uppercase tracking-wide text-text-muted">
                {plan.clientName} &lt;&gt; Taggify · {SHEET_FORMAT_INFO[format].label}
              </p>
              {format === "summary" ? (
                <div className="divide-y divide-border" data-testid="preview-summary">
                  {[
                    ["Total Followers Targeted Overall", followersLabel(plan.overview.totalFollowers)],
                    ["Total Deliverables", String(plan.overview.totalPosts)],
                    ["Expected Impressions/Views", followersLabel(plan.overview.expectedImpressions)],
                    ["Cost", money(plan.overview.subtotal)],
                    ["CPV", plan.overview.expectedImpressions > 0 ? (plan.overview.subtotal / plan.overview.expectedImpressions).toFixed(2) : "—"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between py-1.5 text-[0.8125rem]">
                      <span className="text-text-muted">{label}</span>
                      <span className="font-semibold tabular-nums">{value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="overflow-hidden rounded-md border border-border" data-testid="preview-breakdown">
                  <table className="w-full text-[0.75rem]">
                    <thead>
                      <tr className="border-b border-border text-left text-text-muted">
                        <th className="px-3 py-1.5 font-medium">Particulars</th>
                        <th className="px-3 py-1.5 font-medium">Followers</th>
                        <th className="px-3 py-1.5 font-medium">Items</th>
                        <th className="px-3 py-1.5 text-right font-medium">Total cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {groups.map((g, n) => (
                        <tr key={g.label}>
                          <td className="px-3 py-1.5 font-semibold">{g.label}</td>
                          <td className="px-3 py-1.5 tabular-nums">{followersLabel(g.followers)}</td>
                          <td className="px-3 py-1.5 tabular-nums">{g.items.reduce((sum, i) => sum + linePosts(i), 0)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{money(categoryCosts[n] ?? 0)}</td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="px-3 py-1.5">Total</td>
                        <td className="px-3 py-1.5 tabular-nums">{followersLabel(plan.overview.totalFollowers)}</td>
                        <td className="px-3 py-1.5 tabular-nums">{plan.overview.totalPosts}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(plan.overview.subtotal)}</td>
                      </tr>
                      {plan.isGstPlan && (
                        <tr>
                          <td className="px-3 py-1.5 text-text-muted" colSpan={3}>
                            GST ({plan.gstPercent}%) · total
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{money(plan.overview.total)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {plan.items.length === 0 ? (
                <p className="text-[0.8125rem] text-text-muted">No pages added yet.</p>
              ) : (
                <div className="flex flex-col gap-3" data-testid="preview-pages">
                  {/* One tab per category in the sheet (8 Oct). */}
                  {groups.map((g) => (
                    <div key={g.label} className="overflow-hidden rounded-md border border-border">
                      <p className="border-b border-border bg-surface-2 px-3 py-1.5 text-[0.72rem] font-semibold">{g.label}</p>
                      <table className="w-full text-[0.75rem]">
                        <tbody className="divide-y divide-border">
                          {g.items.map((item, i) => (
                            <tr key={`${item.assetId}-${item.format}`}>
                              <td className="w-8 px-3 py-1.5 tabular-nums text-text-muted">{i + 1}</td>
                              <td className="px-3 py-1.5 font-semibold">{item.asset?.handle ?? "—"}</td>
                              <td className="px-3 py-1.5 tabular-nums">{followersLabel(item.asset?.followers ?? 0)}</td>
                              <td className="px-3 py-1.5">
                                {formatLabel(item.format)}
                                {isCombo(item.format) && item.comboSplit && <span className="block text-[0.7rem] text-text-faint">{comboSplitLabel(item.format, item.comboSplit)} each</span>}
                              </td>
                              <td className="px-3 py-1.5 tabular-nums">{linePosts(item)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card className="flex flex-col gap-4 self-start p-[18px]">
          <div className="flex items-center justify-between">
            <p className="text-[0.875rem] font-semibold">Generate the sheet</p>
            <p className="text-[0.78rem] text-text-muted">
              {money(plan.overview.total)} · {pageCount(plan.items)} pages
            </p>
          </div>
          {inactivePages.length > 0 && (
            <Note tone="warn">
              <span data-testid="inactive-pages-warning">
                {inactivePages.length === 1 ? "A page on this plan is" : `${inactivePages.length} pages on this plan are`} no longer usable ({[...new Set(inactivePages.map((p) => (p.reason === "broken" ? "not found on Instagram" : p.reason === "rejected" ? "rejected" : "switched off")))].join(", ")}): {inactivePages.map((p) => `@${p.handle}`).join(", ")}. Swap {inactivePages.length === 1 ? "it" : "them"} out on the pages step before sharing.
              </span>
            </Note>
          )}
          {generateMutation.isError && !pickingFormat && <GoogleAwareError error={generateMutation.error} fallback="Couldn't generate the sheet." />}
          {share?.shareError && <Note tone="warn">{share.shareError}</Note>}
          {share?.sharedWith && <Note tone="ok">{share.sharedWith} can edit this sheet.</Note>}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5 rounded-[10px] border border-ink bg-surface-2 p-3">
              <p className="text-[0.72rem] font-semibold">Client sheet</p>
              <Button type="button" size="sm" onClick={() => setPickingFormat(true)} disabled={generateMutation.isPending} data-testid="generate-client-sheet">
                {pendingVariant === "client" ? "Generating…" : plan.clientSheetUrl ? "Regenerate" : "Generate"}
              </Button>
              {plan.clientSheetUrl && (
                <a href={plan.clientSheetUrl} target="_blank" rel="noopener noreferrer" className="text-[0.75rem] font-medium text-blue hover:text-text">
                  Open sheet ↗
                </a>
              )}
            </div>
            <div className="flex flex-col gap-1.5 rounded-[10px] border border-border p-3">
              <p className="text-[0.72rem] font-medium text-text-muted">Internal sheet</p>
              <Button type="button" size="sm" variant="secondary" onClick={() => generateMutation.mutate({ variant: "internal" })} disabled={generateMutation.isPending}>
                {pendingVariant === "internal" ? "Generating…" : plan.internalSheetUrl ? "Regenerate" : "Generate"}
              </Button>
              {plan.internalSheetUrl && (
                <a href={plan.internalSheetUrl} target="_blank" rel="noopener noreferrer" className="text-[0.75rem] font-medium text-text-muted hover:text-text">
                  Open sheet ↗
                </a>
              )}
            </div>
          </div>
          <p className="text-[0.75rem] text-text-muted">Company, GST number and address are collected when the client invoice is generated from the plan card.</p>
          <div className="flex flex-col gap-2 border-t border-border pt-4" data-testid="add-variant">
            <p className="text-[0.8125rem] font-semibold">Another option for this client?</p>
            <p className="text-[0.75rem] text-text-muted">
              Starts Plan B, C… with the same client details — only the budget and pages are picked again. Each plan gets its own Overview + Pages tabs in the client and internal sheets.
            </p>
            {variantMutation.isError && <ErrorNotice message={variantMutation.error instanceof ApiError ? variantMutation.error.message : "Couldn't start another plan."} />}
            <Button type="button" variant="secondary" size="sm" onClick={() => variantMutation.mutate()} disabled={variantMutation.isPending}>
              <PlusIcon className="h-3.5 w-3.5" />
              {variantMutation.isPending ? "Starting…" : "Add another plan"}
            </Button>
          </div>
        </Card>
      </div>
      <FooterBar onBack={onBack} meta={`${pageCount(plan.items)} pages · ${money(plan.overview.total)}`}>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </FooterBar>
      {pickingFormat && (
        <SheetFormatModal
          planName={plan.pitchGroupId ? `${plan.name} · ${plan.variantLabel}` : plan.name}
          value={format}
          existingUrl={plan.clientSheetUrl}
          pending={generateMutation.isPending}
          error={generateMutation.isError ? <GoogleAwareError error={generateMutation.error} fallback="Couldn't generate the sheet." /> : null}
          onClose={() => !generateMutation.isPending && setPickingFormat(false)}
          onConfirm={(sheetFormat) => generateMutation.mutate({ variant: "client", sheetFormat })}
        />
      )}
    </div>
  );
}
