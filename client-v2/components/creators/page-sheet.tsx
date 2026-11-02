"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, MessageCircle, RefreshCw, Trash2 } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, assets as assetsApi, canUse, type Asset, type PendingAssetEdit } from "@/lib/api-client";
import { canApprovePages, canDeletePage, canEditPages, canProposeEdits, canSetPageActive, GRADES, isGrade, PAGE_APPROVAL, rateOf, scrapeState, type Grade } from "@/lib/creators";
import { personLabel, roleLabel } from "@/lib/format";
import { invalidatePages } from "@/lib/queries/creators";
import { FORMATS, formatLabel } from "@/lib/formats";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Money } from "@/components/taggify/money";
import { PlatformIcon } from "@/components/taggify/platform-icon";
import { StatusPill } from "@/components/taggify/status-pill";
import { displayHandle, PageAvatar } from "@/components/finance/identity";
import { rateCardsFrom, RateFields, type RateValues } from "@/components/creators/rate-fields";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const count = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-IN"));
const source = (a: Pick<Asset, "platform">) => (a.platform.toLowerCase() === "youtube" ? "YouTube" : "Instagram");
const profileUrl = (a: Asset) => (a.platform.toLowerCase() === "youtube" ? `https://www.youtube.com/@${a.handle}` : `https://www.instagram.com/${a.handle}/`);

/** One page: identity, numbers, campaigns; edit category, grade, group link, rates and engagement overrides; approve; refresh; delete. */
export function PageSheet({ page, onClose, startEditing = false }: { page: Asset | null; onClose: () => void; startEditing?: boolean }) {
  return (
    <Sheet open={!!page} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="page-detail-sheet flex w-full flex-col gap-0 overflow-y-auto p-0">{page && <PageDetails key={page.id} page={page} onClose={onClose} startEditing={startEditing} />}</SheetContent>
    </Sheet>
  );
}

function PageDetails({ page, onClose, startEditing }: { page: Asset; onClose: () => void; startEditing: boolean }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const editable = canEditPages(user);
  // A planner with the Inventory switch (16 Oct): same form, but Save sends a suggestion an admin applies.
  const proposer = canProposeEdits(user);
  const approvable = canApprovePages(user);
  const [editing, setEditing] = useState(startEditing && (editable || proposer));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const st = PAGE_APPROVAL[page.approvalStatus] ?? PAGE_APPROVAL.pending;
  const scrape = scrapeState(page);
  const pending = page.pendingEdit && typeof page.pendingEdit === "object" && Object.keys(page.pendingEdit).length > 0 ? page.pendingEdit : null;
  const priced = FORMATS.filter((f) => rateOf(page, f) != null);

  const refresh = useMutation({
    mutationFn: () => assetsApi.refreshProfile(accessToken!, page.id),
    onSuccess: async () => {
      await invalidatePages(qc);
      toast.success(`${displayHandle(page.handle, page.platform)} updated from ${source(page)}.`);
    },
    onError: (e) => toast.error(errText(e, "Couldn't start the refresh.")),
  });
  const active = page.isActive !== false;
  const setActive = useMutation({
    mutationFn: (on: boolean) => assetsApi.setActive(accessToken!, page.id, on),
    onSuccess: async (_r, on) => {
      await invalidatePages(qc);
      toast.success(`${displayHandle(page.handle, page.platform)} is ${on ? "active" : "inactive"}.`);
    },
    onError: (e) => toast.error(errText(e, "That didn't go through. Try again.")),
  });
  const decide = useMutation({
    mutationFn: (status: "approved" | "rejected") => assetsApi.setApproval(accessToken!, page.id, status),
    onSuccess: async (_r, status) => {
      await invalidatePages(qc);
      toast.success(`${displayHandle(page.handle, page.platform)} ${status === "approved" ? "approved" : "rejected"}.`);
      onClose();
    },
    onError: (e) => toast.error(errText(e, "That didn't go through. Try again.")),
  });
  const decideEdit = useMutation({
    mutationFn: (decision: "approve" | "reject") => assetsApi.decideEdit(accessToken!, page.id, decision),
    onSuccess: async (_r, decision) => {
      await invalidatePages(qc);
      toast.success(decision === "approve" ? "Suggested changes applied." : "Suggested changes discarded.");
    },
    onError: (e) => toast.error(errText(e, "That didn't go through. Try again.")),
  });
  const remove = useMutation({
    mutationFn: () => assetsApi.remove(accessToken!, page.id),
    onSuccess: async () => {
      await invalidatePages(qc);
      toast.success(`${displayHandle(page.handle, page.platform)} removed from Inventory.`);
      onClose();
    },
    onError: (e) => {
      setConfirmDelete(false);
      toast.error(errText(e, "Couldn't remove this page."));
    },
  });

  return (
    <>
      <SheetHeader className="detail-profile-header">
        <div className="flex items-center gap-3">
          <PageAvatar assetId={page.id} handle={page.handle} size="lg" />
          <div className="min-w-0">
            <SheetTitle className="flex items-center gap-1 text-section">
              <PlatformIcon platform={page.platform} size={18} />
              <span className="truncate">{displayHandle(page.handle, page.platform)}</span>
            </SheetTitle>
            <SheetDescription className="truncate">
              {page.fullName ? `${page.fullName} · ` : ""}
              {personLabel(page.owner, "No vendor")}
            </SheetDescription>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={st.tone}>{st.label}</StatusPill>
          {!active && <StatusPill tone="neutral">Inactive</StatusPill>}
          {page.profileBroken && <StatusPill tone="danger">Not on Instagram</StatusPill>}
          {pending && <StatusPill tone="info">Edit suggested</StatusPill>}
          {page.grade && <GradeBadge grade={page.grade} />}
          {page.category && <Badge variant="tag">{page.category}</Badge>}
          <a href={profileUrl(page)} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-small font-semibold">
            Open profile
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      </SheetHeader>

      {editing ? (
        <EditForm page={page} propose={!editable && proposer} onDone={() => setEditing(false)} />
      ) : (
        <div className="detail-profile-body">
          {pending && <PendingEditCard page={page} pending={pending} canDecide={approvable} busy={decideEdit.isPending} onDecide={(d) => decideEdit.mutate(d)} />}
          {canSetPageActive(user) && (
            <div className="detail-availability">
              <div className="min-w-0 flex-1">
                <Label htmlFor="page-active" className="text-body-strong">
                  Available for new plans
                </Label>
                <p className="text-small text-muted-foreground">{active ? "This page can receive new bookings." : "Excluded from new plans. Existing campaigns stay available."}</p>
              </div>
              <Switch id="page-active" checked={active} disabled={setActive.isPending} onCheckedChange={(on) => setActive.mutate(on)} />
            </div>
          )}
          <section aria-labelledby="audience-title" className="detail-audience"><h3 id="audience-title" className="detail-section-title">Audience & engagement</h3><dl className="detail-metrics">
            <Stat label={page.platform.toLowerCase() === "youtube" ? "Subscribers" : "Followers"} value={count(page.followers)} />
            <Stat label="Avg views" value={count(page.engagement.avgViews)} manual={page.engagement.manual?.avgViews} />
            <Stat label="Avg likes" value={count(page.engagement.avgLikes)} manual={page.engagement.manual?.avgLikes} />
            <Stat label="Avg comments" value={count(page.engagement.avgComments)} manual={page.engagement.manual?.avgComments} />
          </dl></section>
          <p className="detail-source">
            {scrape === "fetching"
              ? `Fetching the latest numbers from ${source(page)}…`
              : scrape === "failed"
                ? `Last fetch failed: ${page.lastScrapeError}`
                : page.lastScrapedAt
                  ? `Numbers from ${source(page)}, ${new Date(page.lastScrapedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}.`
                  : `Not fetched from ${source(page)} yet.`}
            {page.engagement.manual && Object.keys(page.engagement.manual).length ? " Figures marked “typed” were entered by hand." : ""}
          </p>

          <section aria-labelledby="details-title" className="flex flex-col gap-2">
            <h3 id="details-title" className="detail-section-title">
              Details
            </h3>
            <dl className="detail-key-values">
              <div className="detail-key-value">
                <dt className="text-label text-muted-foreground">Category</dt>
                <dd className="text-body-strong">{page.category ?? "Not set"}</dd>
              </div>
              <div className="detail-key-value">
                <dt className="text-label text-muted-foreground">Grade</dt>
                <dd className="text-body-strong">{page.grade ? `Grade ${page.grade}` : "Not graded"}</dd>
              </div>
              <div className="detail-key-value">
                <dt className="text-label text-muted-foreground">Vendor</dt>
                <dd className="truncate text-body-strong">{personLabel(page.owner, "No vendor")}</dd>
              </div>
              <div className="detail-key-value">
                <dt className="text-label text-muted-foreground">Added by</dt>
                <dd className="truncate text-body-strong">{page.createdBy ? `${personLabel(page.createdBy)} · ${roleLabel(page.createdBy.role)}` : <span className="font-normal text-muted-foreground">Before tracking</span>}</dd>
              </div>
              <div className="detail-key-value">
                <dt className="text-label text-muted-foreground">Group link</dt>
                <dd className="truncate text-body-strong">
                  {page.groupLink ? (
                    <a href={page.groupLink} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 hover:text-brand-ink" title={page.groupLink}>
                      <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{page.groupLink.replace(/^https?:\/\//, "")}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    </a>
                  ) : (
                    "None"
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="rates-title" className="flex flex-col gap-2">
            <h3 id="rates-title" className="detail-section-title">
              Rates
            </h3>
            {/* Every format (1 Nov) — "—" where the page has no rate, so what's missing is visible too. */}
            <dl className="detail-key-values">
              {FORMATS.map((f) => {
                const v = rateOf(page, f);
                return (
                  <div key={f} className="detail-key-value">
                    <dt className="text-label text-muted-foreground">{formatLabel(f)}</dt>
                    <dd className={v == null ? "text-body text-muted-foreground" : "text-body-strong"}>{v == null ? "—" : <Money value={v} />}</dd>
                  </div>
                );
              })}
            </dl>
            {priced.length === 0 && <p className="text-small text-muted-foreground">No rates yet. A plan line on this page needs its cost typed in.</p>}
          </section>

          <section aria-labelledby="camps-title" className="flex flex-col gap-2">
            <h3 id="camps-title" className="detail-section-title">
              Campaigns ({page.campaigns?.length ?? 0})
            </h3>
            {(page.campaigns?.length ?? 0) === 0 ? (
              <p className="text-small text-muted-foreground">Not booked on a campaign yet.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-card border">
                {page.campaigns.map((c) => (
                  <li key={c.id}>
                    {canUse(user, "campaigns.view") ? (
                      <Link href={`/campaigns/${c.id}`} className="flex flex-col px-3 py-2 text-foreground hover:bg-accent hover:text-foreground">
                        <span className="text-body-strong">{c.title}</span>
                        <span className="text-small text-fg-muted">{c.brandName}</span>
                      </Link>
                    ) : (
                      <span className="flex flex-col px-3 py-2">
                        <span className="text-body-strong">{c.title}</span>
                        <span className="text-small text-fg-muted">{c.brandName}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {!editing && (editable || proposer || (approvable && page.approvalStatus !== "approved")) && (
        <SheetFooter className="mt-auto flex-row flex-wrap gap-2 border-t p-5 sm:justify-start">
          {approvable && page.approvalStatus !== "approved" && (
            <Button variant="success" disabled={decide.isPending} onClick={() => decide.mutate("approved")}>
              Approve page
            </Button>
          )}
          {approvable && page.approvalStatus === "pending" && (
            <Button variant="outline" disabled={decide.isPending} onClick={() => decide.mutate("rejected")}>
              Reject
            </Button>
          )}
          {editable && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                Edit details
              </Button>
              <Button variant="ghost" disabled={refresh.isPending || scrape === "fetching"} onClick={() => refresh.mutate()}>
                <RefreshCw />
                {refresh.isPending ? "Refreshing…" : `Refresh from ${source(page)}`}
              </Button>
            </>
          )}
          {proposer && !editable && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              Suggest an edit
            </Button>
          )}
          {canDeletePage(user) && (
            <Button variant="ghost" className="text-danger-fg hover:text-danger-fg sm:ml-auto" onClick={() => setConfirmDelete(true)} aria-label={`Remove ${displayHandle(page.handle, page.platform)}`}>
              <Trash2 />
              Remove
            </Button>
          )}
        </SheetFooter>
      )}

      <Dialog open={confirmDelete} onOpenChange={(o) => !o && !remove.isPending && setConfirmDelete(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {displayHandle(page.handle, page.platform)}?</DialogTitle>
            <DialogDescription>The page leaves Inventory and any draft plans it is on. A page with posts on record or on an approved plan can&apos;t be removed; switch it to Inactive instead.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={remove.isPending} onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? "Removing…" : "Remove page"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value, manual }: { label: string; value: string; manual?: true }) {
  return (
    <div>
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 text-card-title">
        {value}
        {manual && <Badge variant="tag">typed</Badge>}
      </dd>
    </div>
  );
}

/** "Grade A" as a small neutral pill; the grade is a hand-set tier, not a status. */
export function GradeBadge({ grade, className }: { grade: string; className?: string }) {
  return (
    <Badge variant="tag" className={className}>
      Grade {grade}
    </Badge>
  );
}

/** Grade A / B / C as three pill toggles (the same chip style as filters); the chosen one clicked again clears it. */
export function GradeToggle({ value, onChange, label = "Grade" }: { value: Grade | ""; onChange: (g: Grade | "") => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-2">
      {GRADES.map((g) => {
        const on = value === g;
        return (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${label} ${g}`}
            onClick={() => onChange(on ? "" : g)}
            className={cn("inline-flex h-control-sm w-12 items-center justify-center rounded-pill border text-small transition-colors", on ? "border-brand bg-brand-soft font-semibold text-brand-ink" : "bg-card text-fg-strong hover:bg-muted")}
          >
            {g}
          </button>
        );
      })}
    </div>
  );
}

/** A planner's suggested changes, now → suggested. An admin applies or discards them; the planner sees them waiting. */
function PendingEditCard({ page, pending, canDecide, busy, onDecide }: { page: Asset; pending: PendingAssetEdit; canDecide: boolean; busy: boolean; onDecide: (d: "approve" | "reject") => void }) {
  const rows: [string, string, string][] = [];
  if ("category" in pending) rows.push(["Category", page.category ?? "—", pending.category ?? "—"]);
  if ("grade" in pending) rows.push(["Grade", page.grade ?? "—", pending.grade ?? "—"]);
  if ("groupLink" in pending) rows.push(["Group link", page.groupLink ?? "—", pending.groupLink ?? "—"]);
  for (const rc of pending.rateCards ?? []) {
    const current = rateOf(page, rc.format);
    rows.push([`${formatLabel(rc.format)} rate`, current != null ? `₹${current.toLocaleString("en-IN")}` : "—", `₹${Number(rc.amount).toLocaleString("en-IN")}`]);
  }
  const by = page.pendingEditBy?.name ?? page.pendingEditBy?.email ?? "a planner";
  const when = page.pendingEditAt ? new Date(page.pendingEditAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : null;
  return (
    <section aria-labelledby="pending-edit-title" className="flex flex-col gap-3 rounded-card border border-brand-200 bg-brand-50 p-4" data-testid="pending-edit-card">
      <div>
        <h3 id="pending-edit-title" className="text-body-strong">
          Suggested by {by}
          {when ? <span className="font-normal text-muted-foreground"> · {when}</span> : null}
        </h3>
        <p className="text-small text-muted-foreground">{canDecide ? "Apply changes the page; Discard leaves it as it is." : "Waiting for an admin to apply or discard."}</p>
      </div>
      <dl className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5 text-small">
        {rows.map(([label, from, to]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right text-fg-muted line-through">{from}</dd>
            <dd className="text-right font-semibold">{to}</dd>
          </div>
        ))}
      </dl>
      {canDecide && (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => onDecide("approve")}>
            Apply
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide("reject")}>
            Discard
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * Category, grade, group link, rates (one format at a time) and, for staff, hand-typed engagement.
 * `propose` (a planner): only what changed is sent as a suggestion; nothing is applied until an admin says so.
 */
function EditForm({ page, propose, onDone }: { page: Asset; propose: boolean; onDone: () => void }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const manual = (k: "avgViews" | "avgLikes" | "avgComments") => (page.engagement.manual?.[k] ? String(page.engagement[k] ?? "") : "");
  const [category, setCategory] = useState(page.category ?? "");
  const [grade, setGrade] = useState<Grade | "">(isGrade(page.grade) ? page.grade : "");
  const [groupLink, setGroupLink] = useState(page.groupLink ?? "");
  const saved = FORMATS.filter((f) => rateOf(page, f) != null);
  const [rates, setRates] = useState<RateValues>(() => Object.fromEntries(saved.map((f) => [f, String(rateOf(page, f))])));
  const [eng, setEng] = useState({ avgViews: manual("avgViews"), avgLikes: manual("avgLikes"), avgComments: manual("avgComments") });
  useEffect(() => setCategory(page.category ?? ""), [page.category]);

  const whole = (v: string) => v.trim() === "" || /^\d+$/.test(v.trim());
  const zeroRate = Object.values(rates).some((v) => v.trim() !== "" && !(Number(v) > 0));
  const badLink = groupLink.trim() !== "" && !/^https?:\/\/\S+\.\S+/.test(groupLink.trim());
  const invalid = ![...Object.values(rates), eng.avgViews, eng.avgLikes, eng.avgComments].every(whole) || zeroRate || badLink;
  const nextCategory = category.trim() || null;
  const nextGrade = grade || null;
  const nextLink = groupLink.trim() || null;
  // Only changed rates: re-saving an unchanged one would restart its effective-from date.
  const changedRates = rateCardsFrom(rates).filter((rc) => rc.amount !== rateOf(page, rc.format));

  const save = useMutation({
    mutationFn: async () => {
      if (propose) {
        const body: PendingAssetEdit = {};
        if (nextCategory !== (page.category ?? null)) body.category = nextCategory;
        if (nextGrade !== (page.grade ?? null)) body.grade = nextGrade;
        if (nextLink !== (page.groupLink ?? null)) body.groupLink = nextLink;
        if (changedRates.length) body.rateCards = changedRates;
        if (Object.keys(body).length === 0) throw new Error("Nothing changed.");
        return assetsApi.proposeEdit(accessToken!, page.id, body);
      }
      // The rate-card route needs at least one entry; skip it when nothing changed.
      if (changedRates.length) await assetsApi.updateRateCard(accessToken!, page.id, changedRates);
      const n = (v: string) => (v.trim() === "" ? null : Number(v));
      return assetsApi.updateDetails(accessToken!, page.id, { category: nextCategory, grade: nextGrade, groupLink: nextLink, avgViews: n(eng.avgViews), avgLikes: n(eng.avgLikes), avgComments: n(eng.avgComments) });
    },
    onSuccess: () => {
      toast.success(propose ? "Suggestion sent. An admin will apply it." : "Page updated.");
      onDone();
    },
    // Rates and details are two calls: if the second fails the first already saved, so refresh either way.
    onSettled: () => invalidatePages(qc),
  });

  return (
    <form
      className="flex flex-1 flex-col"
      data-testid="page-edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) save.mutate();
      }}
    >
      <div className="flex flex-col gap-5 p-5">
        {propose && <p className="rounded-md bg-muted px-3 py-2 text-small text-muted-foreground">Your changes go to an admin for approval. The page keeps its current details until then.</p>}
        <div className="flex flex-col gap-2">
          <Label htmlFor="pg-category">Category</Label>
          <Input id="pg-category" maxLength={40} placeholder="e.g. Food, Meme page" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <div className="flex flex-col gap-2">
            <span className="text-label font-medium">Grade</span>
            <GradeToggle value={grade} onChange={setGrade} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pg-group">Group link</Label>
            <Input id="pg-group" type="url" placeholder="https://chat.whatsapp.com/…" value={groupLink} onChange={(e) => setGroupLink(e.target.value)} aria-invalid={badLink || undefined} />
          </div>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-body-strong">Rates (₹ per post)</legend>
          <RateFields idPrefix="pg" values={rates} onChange={setRates} fixed={saved} />
        </fieldset>
        {!propose && (
          <fieldset className="grid grid-cols-3 gap-3">
            <legend className="mb-1 text-body-strong">Engagement</legend>
            <p className="col-span-3 -mt-1 text-small text-muted-foreground">Leave a box empty to use Instagram&apos;s number.</p>
            {(
              [
                ["avgViews", "Avg views"],
                ["avgLikes", "Avg likes"],
                ["avgComments", "Avg comments"],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="flex flex-col gap-2">
                <Label htmlFor={`pg-${k}`}>{label}</Label>
                <Input id={`pg-${k}`} inputMode="numeric" placeholder={page.engagement[k] != null ? String(page.engagement[k]) : ""} value={eng[k]} onChange={(e) => setEng((s) => ({ ...s, [k]: e.target.value }))} />
              </div>
            ))}
          </fieldset>
        )}
        {invalid && <p className="text-small text-danger-helper">{badLink ? "The group link needs to be a full web address (https://…)." : zeroRate ? "A rate can't be ₹0." : "Rates and engagement are whole numbers."}</p>}
        {save.isError && (
          <p className="text-small text-danger-helper" role="alert">
            {errText(save.error, "Couldn't save. Try again.")}
          </p>
        )}
      </div>
      <SheetFooter className="mt-auto flex-row gap-2 border-t p-5 sm:justify-start">
        <Button type="submit" disabled={invalid || save.isPending}>
          {save.isPending ? (propose ? "Sending…" : "Saving…") : propose ? "Send for approval" : "Save"}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </SheetFooter>
    </form>
  );
}
