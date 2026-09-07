"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField } from "@/components/ui/form-field";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { UploadLinksModal } from "@/components/links/upload-links-modal";
import { ResolvePendingAssignmentsModal } from "@/components/campaigns/resolve-pending-assignments-modal";
import { ProgressBar } from "@/components/ui/panel";
import { PlusIcon, CampaignIcon, HeartIcon, AlertIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { campaigns as campaignsApi, assets as assetsApi, links as linksApi, ApiError, type Campaign } from "@/lib/api-client";
import { parseAssignmentSheet, parseWorkImportSheet, type ParsedAssignmentRow, type ParsedWorkImportRow } from "@/lib/parseAssignmentSheet";
import { initialsOf, roleLabel, money, compactNumber } from "@/lib/format";

export default function CampaignsPage() {
  return (
    <RequireAuth>
      <CampaignsContent />
    </RequireAuth>
  );
}

function CampaignsContent() {
  const { user, accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showWorkImport, setShowWorkImport] = useState(false);
  const [uploadCampaign, setUploadCampaign] = useState<Campaign | null>(null);
  // Set once a just-created campaign has rows from its attached sheet that
  // didn't match an existing page (newTask.md #8's "next step ... pending").
  const [pendingResolution, setPendingResolution] = useState<{ campaignId: string; campaignTitle: string } | null>(null);
  const token = accessToken!;

  const campaignsQuery = useQuery({ queryKey: ["campaigns"], queryFn: () => campaignsApi.list(token) });
  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: () => assetsApi.list(token) });
  const items = campaignsQuery.data ?? [];
  const canCreate = user?.role === "ADMIN";
  const canUploadLinks = user?.role === "CREATOR" || user?.role === "TEAM_MEMBER";

  return (
    <AppShell
      active="campaigns"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search campaigns…"
      topbarActions={
        canCreate ? (
          <div className="flex items-center gap-2.5">
            <Button size="default" variant="secondary" onClick={() => setShowWorkImport(true)}>
              Import work
            </Button>
            <Button size="default" onClick={() => setShowForm(true)}>
              <PlusIcon className="h-[15px] w-[15px] text-accent-ink" />
              New campaign
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">Work</p>
            <h1 className="mb-1.5 text-[1.625rem] font-bold">Campaigns</h1>
            <p className="text-[0.9375rem] text-text-muted">Brand deals assigned to your pages.</p>
          </div>
          {/* Desktop carries this same action in the topbar (hidden below md). */}
          {canCreate && (
            <Button size="icon" className="shrink-0 md:hidden" onClick={() => setShowForm(true)} aria-label="New campaign">
              <PlusIcon className="h-4 w-4 text-accent-ink" />
            </Button>
          )}
        </div>

        {campaignsQuery.isLoading ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <TableSkeleton />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface shadow-card">
            <EmptyState label="No campaigns yet." />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                canCreate={canCreate}
                canUploadLinks={canUploadLinks}
                onResolvePending={() => setPendingResolution({ campaignId: c.id, campaignTitle: c.title })}
                onUploadLinks={() => setUploadCampaign(c)}
              />
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <NewCampaignModal
          token={token}
          onClose={() => setShowForm(false)}
          onCreated={(result) => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ["campaigns"] });
            if (result.pendingCount > 0) {
              setPendingResolution({ campaignId: result.campaign.id, campaignTitle: result.campaign.title });
            }
          }}
        />
      )}

      {pendingResolution && (
        <ResolvePendingAssignmentsModal
          token={token}
          campaignId={pendingResolution.campaignId}
          campaignTitle={pendingResolution.campaignTitle}
          onClose={() => setPendingResolution(null)}
          onResolved={() => queryClient.invalidateQueries({ queryKey: ["campaigns"] })}
        />
      )}

      {showWorkImport && (
        <BulkImportWorkModal
          token={token}
          onClose={() => setShowWorkImport(false)}
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

function CampaignCard({
  campaign: c,
  canCreate,
  canUploadLinks,
  onResolvePending,
  onUploadLinks,
}: {
  campaign: Campaign;
  canCreate: boolean;
  canUploadLinks: boolean;
  onResolvePending: () => void;
  onUploadLinks: () => void;
}) {
  const router = useRouter();
  const costCapNum = c.costCap != null ? Number(c.costCap) : null;
  const spentPct = costCapNum && costCapNum > 0 ? ((c.spent ?? 0) / costCapNum) * 100 : null;
  // Derived from spentPct rather than c.remainingBudget directly — they're
  // both meant to agree (remainingBudget = costCap - spent server-side),
  // but computing "over" from the same value the progress bar/percentage
  // already render means the "Over" pill can never show without the budget
  // row that explains it, or vice versa, even if that invariant ever slips.
  const isOver = spentPct != null && spentPct > 100;

  return (
    <div
      data-testid="campaign-card"
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/campaigns/view?id=${c.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(`/campaigns/view?id=${c.id}`);
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card transition-colors hover:border-border-strong",
        isOver && "border-rose/35 bg-gradient-to-b from-rose-soft to-transparent"
      )}
    >
      {/* One representative post's cover, picked server-side (campaigns/service.js)
          from whichever link under this campaign has been scraped — a campaign with
          several posts still only needs one preview here. Falls back to a plain
          icon tile until at least one post has a scraped thumbnail. */}
      {c.representativePost?.thumbnailUrl ? (
        <div className="relative h-40 w-full overflow-hidden rounded-md bg-surface-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- Apify/Instagram-hosted, not a local/optimizable asset */}
          <img src={c.representativePost.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-surface-2">
          <CampaignIcon className="h-4 w-4 text-text-muted" />
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">{c.brandName}</p>
          <p className="mt-1 text-[0.9375rem] font-bold leading-snug">{c.title}</p>
        </div>
        {isOver && (
          <span className="shrink-0 rounded-full border border-rose/35 bg-rose-soft px-2.5 py-1 text-[0.625rem] font-extrabold uppercase tracking-[0.04em] text-rose">
            Over
          </span>
        )}
      </div>

      {c.representativePost?.caption && (
        <p className="-mt-2 line-clamp-2 text-[0.8125rem] text-text-muted">{c.representativePost.caption}</p>
      )}

      <div className="flex items-end justify-between">
        <div className="flex items-center gap-1.5">
          <HeartIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
          <span className="text-[1.0625rem] font-extrabold tabular-nums leading-none">
            {c.totalLikes ? compactNumber(c.totalLikes) : "0"}
          </span>
          <span className="text-[0.75rem] text-text-faint">likes</span>
        </div>
        {!!c.postCount && <span className="text-[0.8125rem] font-semibold text-text-muted">{c.postCount} post{c.postCount === 1 ? "" : "s"}</span>}
      </div>

      {/* Budget — newTask.md #9: remaining = cost cap - spent so far. Only shown when a cap was actually set. */}
      {costCapNum != null && spentPct != null && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[0.8125rem] font-semibold text-text-muted tabular-nums">
              {money(c.spent ?? 0)} / {money(costCapNum)}
            </span>
            <span className={cn("text-[0.8125rem] font-extrabold tabular-nums", isOver ? "text-rose" : "text-accent")}>
              {Math.round(spentPct)}%
            </span>
          </div>
          <ProgressBar pct={spentPct} tone={isOver ? "rose" : "accent"} />
        </div>
      )}

      {canCreate && !!c.pendingAssignmentCount && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onResolvePending();
          }}
          className="flex items-center gap-1.5 rounded-md border border-rose/25 bg-rose-soft px-2.5 py-1.5 text-left text-[0.75rem] font-semibold text-rose"
        >
          <AlertIcon className="h-3.5 w-3.5 shrink-0" />
          {c.pendingAssignmentCount} page{c.pendingAssignmentCount === 1 ? "" : "s"} from the sheet still need{c.pendingAssignmentCount === 1 ? "s" : ""} creating
        </button>
      )}

      <div className="flex items-center justify-between text-xs text-text-faint">
        <span>Created {new Date(c.createdAt).toLocaleDateString()}</span>
        {c.deadline && (
          <span className={new Date(c.deadline) < new Date() ? "font-semibold text-rose" : "font-semibold text-text-muted"}>
            Deadline {new Date(c.deadline).toLocaleDateString()}
          </span>
        )}
      </div>

      {canUploadLinks && (
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={(e) => {
            e.stopPropagation();
            onUploadLinks();
          }}
        >
          Upload Links
        </Button>
      )}
    </div>
  );
}

interface CreateCampaignResult {
  campaign: Campaign;
  matchedCount: number;
  pendingCount: number;
}

function NewCampaignModal({
  token,
  onClose,
  onCreated,
}: {
  token: string;
  onClose: () => void;
  onCreated: (result: CreateCampaignResult) => void;
}) {
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
      if (rows.length === 0) setSheetError("No rows found — check the file has a header row (e.g. \"handle\", \"phone\").");
      setSheetRows(rows);
    } catch {
      setSheetError("Couldn't read that file — make sure it's a CSV export.");
      setSheetRows([]);
    }
  }

  // bugs.md #6 — the "reference link" field already existed (stored as-is
  // on the campaign for humans to click later); this reuses it to also
  // fetch + parse rows, same rows/error state as the file upload above,
  // so admins don't need to separately download and re-upload a CSV.
  const importSheetMutation = useMutation({
    mutationFn: async () => {
      const { csv } = await campaignsApi.importSheetUrl(token, sheetLink);
      return parseAssignmentSheet(csv);
    },
    onSuccess: (rows) => {
      setSheetFileName("");
      setSheetError(rows.length === 0 ? "No rows found — check the sheet has a header row (e.g. \"handle\", \"phone\")." : "");
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

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[480px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="flex flex-1 min-h-0 flex-col gap-5 overflow-y-auto p-6 pt-1"
      >
        <h2 className="text-lg font-bold">New campaign</h2>
        <Field label="Brand name">
          <TextField required value={brandName} onChange={setBrandName} placeholder="e.g. Solmate Coffee" />
        </Field>
        <Field label="Campaign title">
          <TextField required value={title} onChange={setTitle} placeholder="e.g. Solmate Coffee × Launch Week" />
        </Field>
        <Field label="Deadline (optional)">
          <TextField type="date" value={deadline} onChange={setDeadline} />
        </Field>
        <Field label="Total cost cap (optional)">
          <TextField type="number" value={costCap} onChange={setCostCap} placeholder="e.g. 150000" />
        </Field>

        <div className="border-t border-border pt-4">
          <p className="mb-1 text-[0.8125rem] font-semibold">Pages / creators this campaign is for</p>
          <p className="mb-3 text-[0.75rem] text-text-faint">
            Optional — a Google Sheet link (shared as "Anyone with the link can view") or a CSV export of the pages
            (and creator phone numbers) this campaign should go to. Any handle not already in Taggify shows up as
            pending after creating the campaign, with the option to create it right then.
          </p>
          <Field label="Reference link (e.g. a Google Sheet)">
            <div className="flex gap-2">
              <div className="flex-1">
                <TextField type="url" value={sheetLink} onChange={setSheetLink} placeholder="https://docs.google.com/spreadsheets/…" />
              </div>
              {/* Only meaningful for a Google Sheet — a plain reference link (e.g. a
                  Notion doc) can still be saved above without ever clicking this;
                  the sheet only needs to be shared as "Anyone with the link can view". */}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!sheetLink.trim() || importSheetMutation.isPending}
                onClick={() => importSheetMutation.mutate()}
              >
                {importSheetMutation.isPending ? "Fetching…" : "Fetch rows"}
              </Button>
            </div>
          </Field>
          <div className="mt-3">
            <label className="flex h-10 cursor-pointer items-center justify-center rounded-md border border-dashed border-border-strong text-[0.8125rem] font-semibold text-text-muted hover:bg-surface-2">
              {sheetFileName || "…or upload a CSV of pages instead"}
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            </label>
            {sheetError && <p className="mt-1.5 text-[0.75rem] text-rose">{sheetError}</p>}
            {sheetRows.length > 0 && !sheetError && (
              <p className="mt-1.5 text-[0.75rem] text-text-faint">{sheetRows.length} row{sheetRows.length === 1 ? "" : "s"} parsed.</p>
            )}
          </div>
        </div>

        {createMutation.isError && (
          <ErrorNotice message={createMutation.error instanceof ApiError ? createMutation.error.message : "Couldn't create the campaign."} />
        )}
        <div className="flex gap-2.5">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create campaign"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

/**
 * newTask.md #8's second sheet upload: admin imports already-done work
 * (which page posted for which campaign, optionally at what cost) and it's
 * reflected as real Links — same status machine, same downstream invoicing,
 * as if each row had been submitted through the normal flow. Rows that
 * can't be matched to an existing campaign/page are reported, not silently
 * dropped or allowed to invent new ones.
 */
function BulkImportWorkModal({ token, onClose, onImported }: { token: string; onClose: () => void; onImported: () => void }) {
  const [rows, setRows] = useState<ParsedWorkImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");

  function applyParsed(parsed: ParsedWorkImportRow[], emptyMessage: string) {
    setParseError(parsed.length === 0 ? emptyMessage : "");
    setRows(parsed);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    try {
      const parsed = await parseWorkImportSheet(file);
      applyParsed(
        parsed,
        'No usable rows found — needs columns for campaign, page, url, and format (e.g. "campaign", "handle", "url", "format").'
      );
    } catch {
      setParseError("Couldn't read that file — make sure it's a CSV export.");
      setRows([]);
    }
  }

  // bugs.md #6 — paste a Google Sheet link instead of downloading +
  // re-uploading a CSV export; server fetches it (avoids browser CORS),
  // client parses the CSV text exactly as it would an uploaded file.
  const importSheetMutation = useMutation({
    mutationFn: async () => {
      const { csv } = await campaignsApi.importSheetUrl(token, sheetUrl);
      return parseWorkImportSheet(csv);
    },
    onSuccess: (parsed) => {
      setFileName("");
      applyParsed(
        parsed,
        'No usable rows found — needs columns for campaign, page, url, and format (e.g. "campaign", "handle", "url", "format").'
      );
    },
    onError: (err) => setParseError(err instanceof ApiError ? err.message : "Couldn't fetch that sheet."),
  });

  const importMutation = useMutation({
    mutationFn: () => linksApi.bulkImport(token, rows),
    onSuccess: onImported,
  });

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[480px]">
      <div className="flex flex-1 min-h-0 flex-col gap-5 overflow-y-auto p-6 pt-1">
        <div>
          <h2 className="text-lg font-bold">Import work</h2>
          <p className="text-[0.8125rem] text-text-faint">
            Paste a Google Sheet link (shared as "Anyone with the link can view") or upload a CSV of posts that already
            went out — one row each, with the campaign title, page handle, post URL, format, and optionally the cost
            (falls back to the page's rate card if left blank).
          </p>
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <TextField type="url" value={sheetUrl} onChange={setSheetUrl} placeholder="Or paste a Google Sheet link…" />
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!sheetUrl.trim() || importSheetMutation.isPending}
            onClick={() => importSheetMutation.mutate()}
          >
            {importSheetMutation.isPending ? "Fetching…" : "Fetch rows"}
          </Button>
        </div>
        <label className="flex h-10 cursor-pointer items-center justify-center rounded-md border border-dashed border-border-strong text-[0.8125rem] font-semibold text-text-muted hover:bg-surface-2">
          {fileName || "Upload CSV of work…"}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
        </label>
        {parseError && <p className="text-[0.75rem] text-rose">{parseError}</p>}
        {rows.length > 0 && !parseError && (
          <p className="text-[0.75rem] text-text-faint">{rows.length} row{rows.length === 1 ? "" : "s"} parsed.</p>
        )}

        {importMutation.data && (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3.5 text-[0.8125rem]">
            <p className="font-semibold text-accent">{importMutation.data.created.length} link{importMutation.data.created.length === 1 ? "" : "s"} created.</p>
            {importMutation.data.skipped.length > 0 && (
              <>
                <p className="font-semibold text-rose">{importMutation.data.skipped.length} skipped:</p>
                <ul className="flex flex-col gap-1 text-text-faint">
                  {importMutation.data.skipped.map((s, i) => (
                    <li key={i}>{s.reason}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {importMutation.isError && (
          <ErrorNotice message={importMutation.error instanceof ApiError ? importMutation.error.message : "Couldn't import this sheet."} />
        )}

        <div className="flex gap-2.5">
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
