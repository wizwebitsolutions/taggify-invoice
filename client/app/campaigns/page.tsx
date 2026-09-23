"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField, MoneyField } from "@/components/ui/form-field";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/chips";
import { Steps } from "@/components/ui/steps";
import { Note } from "@/components/ui/note";
import { Tag } from "@/components/ui/tag";
import { Card, Table, THead, TH, TR, TD, Cell2 } from "@/components/ui/data-table";
import { ProgressBar } from "@/components/ui/panel";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { ResolvePendingAssignmentsModal } from "@/components/campaigns/resolve-pending-assignments-modal";
import { UploadLinksModal } from "@/components/links/upload-links-modal";
import { PlusIcon, AlertIcon, SearchIcon, DownloadIcon, ArrowRightIcon, MoreIcon, CampaignIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { campaigns as campaignsApi, assets as assetsApi, links as linksApi, ApiError, hasAccess, type Campaign } from "@/lib/api-client";
import { parseAssignmentSheet, parseWorkImportSheet, type ParsedAssignmentRow, type ParsedWorkImportRow } from "@/lib/parseAssignmentSheet";
import { initialsOf, roleLabel, money, compactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function CampaignsPage() {
  return (
    <RequireAuth>
      <Suspense>
        <CampaignsContent />
      </Suspense>
    </RequireAuth>
  );
}

const DAY = 24 * 60 * 60 * 1000;
const shortDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");

function isLive(c: Campaign) {
  return !c.deadline || new Date(c.deadline).getTime() >= Date.now() - DAY;
}

/**
 * Campaigns list (premium mockup 04): one table, not a grid of cards —
 * budget, spend and what's still owed per brand deal, scannable in one
 * pass. Tabs split live / completed; search filters by title or brand.
 * Phases roll up under their phase-1 row.
 */
function CampaignsContent() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(params.get("new") === "1");
  const [showWorkImport, setShowWorkImport] = useState(params.get("import") === "1");
  const [uploadCampaign, setUploadCampaign] = useState<Campaign | null>(null);
  const [pendingResolution, setPendingResolution] = useState<{ campaignId: string; campaignTitle: string } | null>(null);
  const [tab, setTab] = useState<"live" | "awaiting" | "completed" | "all">("live");
  const [search, setSearch] = useState("");
  const token = accessToken!;

  const campaignsQuery = useQuery({ queryKey: ["campaigns"], queryFn: () => campaignsApi.list(token) });
  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token) });
  const items = campaignsQuery.data ?? [];
  // A plain ADMIN by default, or (15 Sep) any other role explicitly granted campaigns.manage.
  const canCreate = hasAccess(user, "campaigns.edit");
  const canUploadLinks = user?.role === "CREATOR" || user?.role === "TEAM_MEMBER";

  // Only phase-1 rows are listed; a later phase's posts/spend already roll
  // up into its parent server-side (annotateCampaign). Except a creator's own
  // numbered phase entries (22 Sep) — each is a campaign to them, with its
  // own Upload links, so those rows (creatorPhaseNumber set) stay.
  const roots = useMemo(() => items.filter((c) => !c.parentCampaignId || c.creatorPhaseNumber != null), [items]);
  const counts = useMemo(
    () => ({
      live: roots.filter(isLive).length,
      awaiting: roots.filter((c) => (c.pendingAssignmentCount ?? 0) > 0).length,
      completed: roots.filter((c) => !isLive(c)).length,
      all: roots.length,
    }),
    [roots]
  );
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roots
      .filter((c) => (tab === "live" ? isLive(c) : tab === "completed" ? !isLive(c) : tab === "awaiting" ? (c.pendingAssignmentCount ?? 0) > 0 : true))
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.brandName.toLowerCase().includes(q));
  }, [roots, tab, search]);

  useEffect(() => {
    // Deep links from the admin home ("New campaign" / "Import sheet").
    if (params.get("new") === "1") setShowForm(true);
    if (params.get("import") === "1") setShowWorkImport(true);
  }, [params]);

  return (
    <AppShell
      active="campaigns"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search campaigns…"
      topbarActions={
        canCreate ? (
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setShowWorkImport(true)}>
              <DownloadIcon className="h-4 w-4" />
              Import work
            </Button>
            <Button onClick={() => setShowForm(true)}>
              <PlusIcon className="h-4 w-4" />
              New campaign
            </Button>
          </div>
        ) : undefined
      }
      fab={
        canCreate ? (
          <Button size="icon" className="h-12 w-12 rounded-full shadow-lg" onClick={() => setShowForm(true)} aria-label="New campaign">
            <PlusIcon className="h-5 w-5" />
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <PageHeader title="Campaigns" subtitle={canCreate ? "Budget, spend and what is still owed, per brand deal." : "Brand deals assigned to your pages."} />

        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: "live", label: "Live", count: counts.live },
                ...(canCreate ? [{ value: "awaiting" as const, label: "Awaiting people", count: counts.awaiting }] : []),
                { value: "completed", label: "Completed", count: counts.completed },
                { value: "all", label: "All", count: counts.all },
              ]}
            />
          </div>
          <label className="relative block w-full sm:w-[240px]">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search campaigns" aria-label="Search campaigns" className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[0.8125rem] shadow-card placeholder:text-text-faint focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink-10" />
          </label>
        </div>

        <Card>
          {campaignsQuery.isLoading ? (
            <TableSkeleton />
          ) : visible.length === 0 ? (
            <EmptyState label={roots.length === 0 ? "No campaigns yet." : "No campaigns match."} />
          ) : (
            <Table data-testid="campaigns-table">
              <THead>
                <tr>
                  <TH>Campaign</TH>
                  <TH className="hidden md:table-cell">Phase</TH>
                  <TH className="hidden sm:table-cell">Posts</TH>
                  <TH className="hidden lg:table-cell">Likes</TH>
                  <TH className="w-[220px]">Budget used</TH>
                  <TH right className="hidden md:table-cell">
                    Remaining
                  </TH>
                  <TH right className="hidden sm:table-cell">
                    Ends
                  </TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {visible.map((c, i) => (
                  <CampaignRow
                    key={c.id}
                    campaign={c}
                    index={i}
                    canCreate={canCreate}
                    canUploadLinks={canUploadLinks}
                    onOpen={() => router.push(`/campaigns/view?id=${c.id}`)}
                    onResolvePending={() => setPendingResolution({ campaignId: c.id, campaignTitle: c.title })}
                    onUploadLinks={() => setUploadCampaign(c)}
                  />
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {showForm && (
        <NewCampaignWizard
          token={token}
          onClose={() => {
            setShowForm(false);
            if (params.get("new")) router.replace("/campaigns");
          }}
          onCreated={(result) => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ["campaigns"] });
            if (result.pendingCount > 0) setPendingResolution({ campaignId: result.campaign.id, campaignTitle: result.campaign.title });
          }}
        />
      )}

      {pendingResolution && (
        <ResolvePendingAssignmentsModal token={token} campaignId={pendingResolution.campaignId} campaignTitle={pendingResolution.campaignTitle} onClose={() => setPendingResolution(null)} onResolved={() => queryClient.invalidateQueries({ queryKey: ["campaigns"] })} />
      )}

      {showWorkImport && (
        <BulkImportWorkModal
          token={token}
          onClose={() => {
            setShowWorkImport(false);
            if (params.get("import")) router.replace("/campaigns");
          }}
          onImported={() => queryClient.invalidateQueries({ queryKey: ["campaigns"] })}
        />
      )}

      {uploadCampaign && (
        <UploadLinksModal
          token={token}
          campaigns={[uploadCampaign]}
          initialCampaignId={uploadCampaign.id}
          assets={assetsQuery.data ?? []}
          onClose={() => setUploadCampaign(null)}
          onCreated={() => {
            setUploadCampaign(null);
            queryClient.invalidateQueries({ queryKey: ["links"] });
          }}
        />
      )}
    </AppShell>
  );
}

function CampaignRow({ campaign: c, index, canCreate, canUploadLinks, onOpen, onResolvePending, onUploadLinks }: { campaign: Campaign; index: number; canCreate: boolean; canUploadLinks: boolean; onOpen: () => void; onResolvePending: () => void; onUploadLinks: () => void }) {
  const costCapNum = c.costCap != null ? Number(c.costCap) : null;
  const spentPct = costCapNum && costCapNum > 0 ? ((c.spent ?? 0) / costCapNum) * 100 : null;
  const isOver = spentPct != null && spentPct > 100;
  const ended = !isLive(c);
  const tone = isOver ? "rose" : spentPct != null && spentPct >= 85 ? "warn" : "accent";
  return (
    <TR
      interactive
      data-testid="campaign-card"
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      style={{ animationDelay: `${0.2 + index * 0.04}s` }}
    >
      <TD>
        <div className="flex items-center gap-3">
          {c.representativePost?.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.representativePost.thumbnailUrl} alt="" className="h-[38px] w-[38px] shrink-0 rounded-md object-cover" />
          ) : (
            <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-muted">
              <CampaignIcon className="h-4 w-4" />
            </span>
          )}
          <Cell2 primary={c.title} secondary={c.brandName}>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {isOver && <Tag tone="bad">Over</Tag>}
              {ended && <Tag tone="neutral">Ended</Tag>}
              {canCreate && !!c.pendingAssignmentCount && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onResolvePending();
                  }}
                  className="inline-flex h-[22px] items-center gap-1 rounded-[6px] border border-accent-2-line bg-accent-2-soft px-2 text-[0.7rem] font-medium text-accent-2 hover:border-accent-2"
                >
                  <AlertIcon className="h-3 w-3" />
                  {c.pendingAssignmentCount} page{c.pendingAssignmentCount === 1 ? "" : "s"} from the sheet still need{c.pendingAssignmentCount === 1 ? "s" : ""} creating
                </button>
              )}
              {canUploadLinks && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUploadLinks();
                  }}
                  className="inline-flex h-[22px] items-center gap-1 rounded-[6px] border border-border bg-surface px-2 text-[0.7rem] font-medium text-text-2 hover:border-ink"
                >
                  <PlusIcon className="h-3 w-3" />
                  Upload Links
                </button>
              )}
            </div>
          </Cell2>
        </div>
      </TD>
      {/* A creator's list has one entry per phase they're booked on (22 Sep), each numbered in their own running count. */}
      <TD className="hidden md:table-cell">{c.creatorPhaseNumber != null ? `Phase ${c.creatorPhaseNumber}` : (c.phaseCount ?? 1) > 1 ? `${c.phaseCount} phases` : "Phase 1"}</TD>
      <TD className="hidden tabular-nums sm:table-cell">{c.postCount ?? 0}</TD>
      <TD className="hidden tabular-nums lg:table-cell">{c.totalLikes ? compactNumber(c.totalLikes) : "0"}</TD>
      <TD>
        {costCapNum != null && spentPct != null ? (
          <div className="flex flex-col gap-1.5">
            <ProgressBar pct={spentPct} tone={tone} />
            <span className={cn("text-[0.75rem] tabular-nums text-text-muted", isOver && "font-semibold text-rose")}>
              {money(c.spent ?? 0)} / {money(costCapNum)} · {Math.round(spentPct)}%
            </span>
          </div>
        ) : (
          <span className="text-[0.78rem] text-text-muted">{money(c.spent ?? 0)} · no cap</span>
        )}
      </TD>
      <TD right className="hidden md:table-cell">
        {c.remainingBudget != null ? <b className={cn("font-semibold", c.remainingBudget < 0 && "text-rose")}>{money(c.remainingBudget)}</b> : <span className="text-text-muted">—</span>}
      </TD>
      <TD right className={cn("hidden text-[0.8125rem] text-text-muted sm:table-cell", ended && c.deadline && "text-rose")}>
        {shortDate(c.deadline)}
      </TD>
      <TD right>
        <MoreIcon className="h-4 w-4 text-text-faint" />
      </TD>
    </TR>
  );
}

interface CreateCampaignResult {
  campaign: Campaign;
  matchedCount: number;
  pendingCount: number;
  autoAttachedCount: number;
}

const WIZARD_STEPS = ["Basics", "Budget & phase", "Pages", "Review"];

/**
 * New-campaign wizard (premium mockup 06): four steps with a review before
 * commit. Step 3 imports pages from a Google Sheet link or a CSV; handles
 * not in the database are flagged as "will be created" rather than failing.
 */
function NewCampaignWizard({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: (result: CreateCampaignResult) => void }) {
  const [step, setStep] = useState(0);
  const [brandName, setBrandName] = useState("");
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [costCap, setCostCap] = useState("");
  const [sheetLink, setSheetLink] = useState("");
  const [sheetRows, setSheetRows] = useState<ParsedAssignmentRow[]>([]);
  const [sheetFileName, setSheetFileName] = useState("");
  const [sheetError, setSheetError] = useState("");

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setSheetFileName(file.name);
    setSheetError("");
    try {
      const rows = await parseAssignmentSheet(file);
      if (rows.length === 0) setSheetError('No rows found — check the file has a header row (e.g. "handle", "phone").');
      setSheetRows(rows);
    } catch {
      setSheetError("Couldn't read that file — make sure it's a CSV export.");
      setSheetRows([]);
    }
  }

  const importSheetMutation = useMutation({
    mutationFn: async () => {
      const { csv } = await campaignsApi.importSheetUrl(token, sheetLink);
      return parseAssignmentSheet(csv);
    },
    onSuccess: (rows) => {
      setSheetFileName("");
      setSheetError(rows.length === 0 ? 'No rows found — check the sheet has a header row (e.g. "handle", "phone").' : "");
      setSheetRows(rows);
    },
    onError: (err) => setSheetError(err instanceof ApiError ? err.message : "Couldn't fetch that sheet."),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      campaignsApi.create(token, {
        brandName,
        title,
        deadline: deadline || undefined,
        costCap: costCap ? Number(costCap) : undefined,
        sheetLink: sheetLink || undefined,
        assignments: sheetRows.length > 0 ? sheetRows : undefined,
      }),
    onSuccess: onCreated,
  });

  const basicsOk = brandName.trim().length > 0 && title.trim().length > 0;
  const rowCost = sheetRows.reduce((s, r) => s + (r.cost ? Number(r.cost) : 0), 0);
  const withPosts = sheetRows.filter((r) => r.postUrl).length;

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[560px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 3) setStep(step + 1);
          else createMutation.mutate();
        }}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6 pt-1"
        data-testid="new-campaign-wizard"
      >
        <div className="shrink-0">
          <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">New campaign</h2>
          <p className="text-[0.8125rem] text-text-muted">
            Step {step + 1} of 4 · {["What is this deal?", "How much, and by when?", "Which pages will post?", "Check everything before creating."][step]}
          </p>
        </div>
        <Steps steps={WIZARD_STEPS} current={step} />

        {step === 0 && (
          <div className="flex flex-col gap-4">
            <Field label="Brand name">
              <TextField required value={brandName} onChange={setBrandName} placeholder="e.g. Zomato" />
            </Field>
            <Field label="Campaign title">
              <TextField required value={title} onChange={setTitle} placeholder="e.g. Zomato Diwali" />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <Field label="Total budget cap (optional)">
              <MoneyField value={costCap} onChange={setCostCap} placeholder="7,20,000" aria-label="Total budget cap" />
            </Field>
            <Field label="Deadline (optional)">
              <TextField type="date" value={deadline} onChange={setDeadline} />
            </Field>
            <Note tone="info">This creates Phase 1. Add Phase 2 later from the campaign page when a second batch of posts is needed under the same deal.</Note>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <p className="text-[0.8125rem] text-text-muted">Optional — a Google Sheet link (shared as &quot;Anyone with the link can view&quot;) or a CSV with page handle, creator phone, format and cost. We match handles against inventory and flag the rest.</p>
            <Field label="Reference link (e.g. a Google Sheet)">
              <div className="flex gap-2">
                <div className="flex-1">
                  <TextField type="url" value={sheetLink} onChange={setSheetLink} placeholder="https://docs.google.com/spreadsheets/…" />
                </div>
                <Button type="button" variant="secondary" disabled={!sheetLink.trim() || importSheetMutation.isPending} onClick={() => importSheetMutation.mutate()}>
                  {importSheetMutation.isPending ? "Fetching…" : "Fetch rows"}
                </Button>
              </div>
            </Field>
            <label className="flex h-[76px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-border-strong text-[0.8125rem] font-medium text-text-muted hover:bg-surface-2">
              <DownloadIcon className="h-4 w-4" />
              {sheetFileName || "…or drop a CSV of pages instead"}
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            </label>
            {sheetError && <p className="text-[0.75rem] text-rose">{sheetError}</p>}
            {sheetRows.length > 0 && !sheetError && (
              <>
                <p className="text-[0.75rem] text-text-muted">
                  {sheetRows.length} row{sheetRows.length === 1 ? "" : "s"} parsed.{withPosts > 0 && <> {withPosts} of them name a post — it&apos;ll be attached to the matched creator automatically.</>}
                </p>
                <Card>
                  <Table>
                    <THead>
                      <tr>
                        <TH>Page</TH>
                        <TH>Phone</TH>
                        <TH>Format</TH>
                        <TH right>Cost</TH>
                      </tr>
                    </THead>
                    <tbody>
                      {sheetRows.slice(0, 8).map((r, i) => (
                        <TR key={i}>
                          <TD className="font-semibold">@{r.handle}</TD>
                          <TD className="text-text-muted">{r.phone || "—"}</TD>
                          <TD className="text-text-muted">{r.format || "—"}</TD>
                          <TD right>{r.cost ? money(Number(r.cost)) : "—"}</TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                  {sheetRows.length > 8 && <p className="border-t border-border px-[18px] py-2 text-[0.75rem] text-text-muted">+{sheetRows.length - 8} more rows</p>}
                </Card>
                <Note>Pages that aren&apos;t in your database will be created as pending creators after the campaign is made, with passwords you can view and share.</Note>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-3">
            <ReviewRow label="Brand" value={brandName} />
            <ReviewRow label="Title" value={title} />
            <ReviewRow label="Budget cap" value={costCap ? money(Number(costCap)) : "No cap"} />
            <ReviewRow label="Deadline" value={deadline ? new Date(deadline).toLocaleDateString() : "None"} />
            <ReviewRow label="Pages" value={sheetRows.length > 0 ? `${sheetRows.length} from sheet${rowCost > 0 ? ` · ${money(rowCost)}` : ""}` : "Add later"} />
            {costCap && rowCost > Number(costCap) && <Note>Sheet cost ({money(rowCost)}) is above the cap ({money(Number(costCap))}).</Note>}
          </div>
        )}

        {createMutation.isError && <ErrorNotice message={createMutation.error instanceof ApiError ? createMutation.error.message : "Couldn't create the campaign."} />}

        <div className="mt-auto flex items-center gap-2 border-t border-border pt-4">
          {step > 0 ? (
            <Button type="button" variant="secondary" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          )}
          <span className="ml-auto" />
          {step < 3 ? (
            <Button type="submit" disabled={step === 0 && !basicsOk}>
              {step === 2 ? "Continue to review" : "Continue"} <ArrowRightIcon className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="submit" disabled={createMutation.isPending || !basicsOk}>
              {createMutation.isPending ? "Creating…" : "Create campaign"}
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3.5 py-2.5 text-[0.8375rem]">
      <span className="text-text-muted">{label}</span>
      <span className="truncate font-semibold">{value}</span>
    </div>
  );
}

/** Import already-done work as real Links (newTask.md #8's second sheet). */
function BulkImportWorkModal({ token, onClose, onImported }: { token: string; onClose: () => void; onImported: () => void }) {
  const [rows, setRows] = useState<ParsedWorkImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const EMPTY = 'No usable rows found — needs columns for campaign, page, url, and format (e.g. "campaign", "handle", "url", "format").';

  function applyParsed(parsed: ParsedWorkImportRow[]) {
    setParseError(parsed.length === 0 ? EMPTY : "");
    setRows(parsed);
  }
  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    try {
      applyParsed(await parseWorkImportSheet(file));
    } catch {
      setParseError("Couldn't read that file — make sure it's a CSV export.");
      setRows([]);
    }
  }
  const importSheetMutation = useMutation({
    mutationFn: async () => {
      const { csv } = await campaignsApi.importSheetUrl(token, sheetUrl);
      return parseWorkImportSheet(csv);
    },
    onSuccess: (parsed) => {
      setFileName("");
      applyParsed(parsed);
    },
    onError: (err) => setParseError(err instanceof ApiError ? err.message : "Couldn't fetch that sheet."),
  });
  const importMutation = useMutation({ mutationFn: () => linksApi.bulkImport(token, rows), onSuccess: onImported });

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[520px]">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6 pt-1">
        <div>
          <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">Import work</h2>
          <p className="text-[0.8125rem] text-text-muted">Paste a Google Sheet link or upload a CSV of posts that already went out — one row each with campaign title, page handle, post URL, format, and optionally the cost.</p>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <TextField type="url" value={sheetUrl} onChange={setSheetUrl} placeholder="Or paste a Google Sheet link…" />
          </div>
          <Button type="button" variant="secondary" disabled={!sheetUrl.trim() || importSheetMutation.isPending} onClick={() => importSheetMutation.mutate()}>
            {importSheetMutation.isPending ? "Fetching…" : "Fetch rows"}
          </Button>
        </div>
        <label className="flex h-[76px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-border-strong text-[0.8125rem] font-medium text-text-muted hover:bg-surface-2">
          <DownloadIcon className="h-4 w-4" />
          {fileName || "Upload CSV of work…"}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
        </label>
        {parseError && <p className="text-[0.75rem] text-rose">{parseError}</p>}
        {rows.length > 0 && !parseError && (
          <p className="text-[0.75rem] text-text-muted">
            {rows.length} row{rows.length === 1 ? "" : "s"} parsed.
          </p>
        )}
        {importMutation.data && (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3.5 text-[0.8125rem]">
            <p className="font-semibold text-accent">
              {importMutation.data.created.length} link{importMutation.data.created.length === 1 ? "" : "s"} created.
            </p>
            {importMutation.data.skipped.length > 0 && (
              <>
                <p className="font-semibold text-rose">{importMutation.data.skipped.length} skipped:</p>
                <ul className="flex flex-col gap-1 text-text-muted">
                  {importMutation.data.skipped.map((s, i) => (
                    <li key={i}>{s.reason}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {importMutation.isError && <ErrorNotice message={importMutation.error instanceof ApiError ? importMutation.error.message : "Couldn't import this sheet."} />}
        <div className="mt-auto flex gap-2.5 border-t border-border pt-4">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            {importMutation.data ? "Close" : "Cancel"}
          </Button>
          {!importMutation.data && (
            <Button className="flex-1" onClick={() => importMutation.mutate()} disabled={rows.length === 0 || importMutation.isPending}>
              {importMutation.isPending ? "Importing…" : `Import ${rows.length || ""} row${rows.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
