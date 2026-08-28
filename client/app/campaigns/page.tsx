"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField } from "@/components/ui/form-field";
import { CategoryPicker } from "@/components/ui/category-picker";
import { TableSkeleton, EmptyState, ErrorNotice } from "@/components/ui/table-parts";
import { UploadLinksModal } from "@/components/links/upload-links-modal";
import { PlusIcon, CampaignIcon, HeartIcon, AlertIcon, CheckCircleIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import {
  campaigns as campaignsApi,
  assets as assetsApi,
  auth as authApi,
  admin as adminApi,
  links as linksApi,
  LINK_FORMATS,
  ApiError,
  type Campaign,
  type CampaignAssignment,
} from "@/lib/api-client";
import { parseAssignmentSheet, parseWorkImportSheet, type ParsedAssignmentRow, type ParsedWorkImportRow } from "@/lib/parseAssignmentSheet";
import { initialsOf, roleLabel, money } from "@/lib/format";

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
              <div key={c.id} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card">
                {/* One representative post's cover, picked server-side (campaigns/service.js)
                    from whichever link under this campaign has been scraped — a campaign with
                    several posts still only needs one preview here. Falls back to a plain
                    icon tile until at least one post has a scraped thumbnail. */}
                {c.representativePost?.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Apify/Instagram-hosted, not a local/optimizable asset
                  <img
                    src={c.representativePost.thumbnailUrl}
                    alt=""
                    className="h-40 w-full rounded-md bg-surface-2 object-cover"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-surface-2">
                    <CampaignIcon className="h-4 w-4 text-text-muted" />
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold text-text-faint">{c.brandName}</p>
                  <p className="mt-1 text-[0.9375rem] font-bold leading-snug">{c.title}</p>
                  {c.representativePost?.caption && (
                    <p className="mt-1.5 line-clamp-2 text-[0.8125rem] text-text-muted">{c.representativePost.caption}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-text-faint">
                  <HeartIcon className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {c.totalLikes ? `${c.totalLikes.toLocaleString()} likes total` : "No engagement yet"}
                    {c.postCount ? ` · ${c.postCount} post${c.postCount === 1 ? "" : "s"}` : ""}
                  </span>
                </div>
                {/* Budget — newTask.md #9: remaining = cost cap - spent so far. Only shown when a cap was actually set. */}
                {c.costCap != null && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-faint">Budget</span>
                    <span className={c.remainingBudget != null && c.remainingBudget < 0 ? "font-semibold text-rose" : "font-semibold text-text-muted"}>
                      {money(c.remainingBudget ?? 0)} left of {money(c.costCap)}
                    </span>
                  </div>
                )}
                {canCreate && !!c.pendingAssignmentCount && (
                  <button
                    type="button"
                    onClick={() => setPendingResolution({ campaignId: c.id, campaignTitle: c.title })}
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
                  <Button size="sm" variant="secondary" className="w-full" onClick={() => setUploadCampaign(c)}>
                    Upload Links
                  </Button>
                )}
              </div>
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
            Optional — attach a reference link and/or upload a CSV export of the pages (and creator phone numbers) this
            campaign should go to. Any handle not already in Taggify shows up as pending after creating the campaign,
            with the option to create it right then.
          </p>
          <Field label="Reference link (e.g. a Google Sheet)">
            <TextField type="url" value={sheetLink} onChange={setSheetLink} placeholder="https://docs.google.com/spreadsheets/…" />
          </Field>
          <div className="mt-3">
            <label className="flex h-10 cursor-pointer items-center justify-center rounded-md border border-dashed border-border-strong text-[0.8125rem] font-semibold text-text-muted hover:bg-surface-2">
              {sheetFileName || "Upload CSV of pages…"}
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
 * "Next step" from newTask.md #8: rows from the attached sheet that didn't
 * match an existing page, with the option to create each one right here.
 * Reachable again later too (the campaign card's pending badge reopens
 * this), so nothing has to be resolved in one sitting.
 */
function ResolvePendingAssignmentsModal({
  token,
  campaignId,
  campaignTitle,
  onClose,
  onResolved,
}: {
  token: string;
  campaignId: string;
  campaignTitle: string;
  onClose: () => void;
  onResolved: () => void;
}) {
  const queryClient = useQueryClient();
  const assignmentsQuery = useQuery({
    queryKey: ["campaignAssignments", campaignId],
    queryFn: () => campaignsApi.listAssignments(token, campaignId),
  });

  const pending = (assignmentsQuery.data ?? []).filter((a) => a.status === "pending");
  const matchedCount = (assignmentsQuery.data ?? []).length - pending.length;

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[520px]">
      <div className="flex flex-1 min-h-0 flex-col gap-5 overflow-y-auto p-6 pt-1">
        <div>
          <h2 className="text-lg font-bold">Pending pages · {campaignTitle}</h2>
          <p className="text-[0.8125rem] text-text-faint">
            {matchedCount} row{matchedCount === 1 ? "" : "s"} matched an existing page. {pending.length} still need
            one created.
          </p>
        </div>

        {assignmentsQuery.isLoading ? (
          <TableSkeleton />
        ) : pending.length === 0 ? (
          <EmptyState label="All rows are matched." />
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((a) => (
              <PendingAssignmentRow
                key={a.id}
                token={token}
                campaignId={campaignId}
                assignment={a}
                onResolved={() => {
                  queryClient.invalidateQueries({ queryKey: ["campaignAssignments", campaignId] });
                  onResolved();
                }}
              />
            ))}
          </div>
        )}

        <Button variant="ghost" onClick={onClose}>
          Done for now
        </Button>
      </div>
    </Sheet>
  );
}

function PendingAssignmentRow({
  token,
  campaignId,
  assignment,
  onResolved,
}: {
  token: string;
  campaignId: string;
  assignment: CampaignAssignment;
  onResolved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [phone, setPhone] = useState(assignment.creatorPhone?.replace(/^\+91/, "") ?? "");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [rates, setRates] = useState<Record<string, string>>({});

  const resolveMutation = useMutation({
    mutationFn: async () => {
      // The phone might already belong to an existing creator (this page's
      // owner just hadn't registered this particular handle yet) — reuse
      // them instead of erroring, rather than forcing a duplicate account.
      let ownerId: string;
      let generatedPassword: string | null = null;
      try {
        const signupResult = await authApi.signup(token, {
          phoneNumber: `+91${phone.replace(/\D/g, "")}`,
          name: name || undefined,
          role: "CREATOR",
        });
        ownerId = signupResult.user.id;
        generatedPassword = signupResult.generatedPassword;
      } catch (err) {
        if (err instanceof ApiError && err.code === "PHONE_ALREADY_REGISTERED") {
          const allUsers = await adminApi.users(token);
          const existing = allUsers.find((u) => u.phoneNumber === `+91${phone.replace(/\D/g, "")}`);
          if (!existing) throw err;
          ownerId = existing.id;
        } else {
          throw err;
        }
      }

      const asset = await assetsApi.create(token, assignment.pageHandle, "instagram", {
        category: category || undefined,
        ownerId,
      });
      const rateCards = Object.entries(rates)
        .filter(([, amount]) => amount.trim())
        .map(([format, amount]) => ({ format, amount: Number(amount) }));
      if (rateCards.length > 0) await assetsApi.updateRateCard(token, asset.id, rateCards);
      await campaignsApi.resolveAssignment(token, campaignId, assignment.id, asset.id);
      return generatedPassword;
    },
    onSuccess: onResolved,
  });

  if (resolveMutation.isSuccess) {
    return (
      <div className="flex items-center gap-2.5 rounded-md border border-accent/25 bg-accent-soft px-3.5 py-3 text-[0.8125rem]">
        <CheckCircleIcon className="h-4 w-4 shrink-0 text-accent" />
        <span>
          @{assignment.pageHandle} created.
          {resolveMutation.data && (
            <>
              {" "}
              Password: <span className="font-mono font-bold">{resolveMutation.data}</span> — share it now, it can't be shown again.
            </>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border p-3.5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[0.8125rem] font-bold">@{assignment.pageHandle}</p>
          {assignment.creatorPhone && <p className="text-[0.75rem] text-text-faint">{assignment.creatorPhone}</p>}
        </div>
        <Button size="sm" variant="secondary" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Cancel" : "Create"}
        </Button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2.5 border-t border-border pt-3">
          <div className="flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-2.5">
            <span className="text-[0.8125rem] text-text-faint">+91</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Creator's phone number"
              className="w-full bg-transparent text-[0.8125rem] text-text placeholder:text-text-faint focus:outline-none"
            />
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Creator's name (optional)"
            className="h-9 w-full rounded-md border border-border-strong bg-surface-2 px-2.5 text-[0.8125rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <CategoryPicker value={category} onChange={setCategory} />
          <div className="grid grid-cols-2 gap-2">
            {LINK_FORMATS.map((format) => (
              <div key={format} className="flex items-center justify-between gap-2">
                <span className="text-[0.75rem] capitalize text-text-faint">{format}</span>
                <input
                  type="number"
                  min={0}
                  value={rates[format] ?? ""}
                  onChange={(e) => setRates((prev) => ({ ...prev, [format]: e.target.value }))}
                  placeholder="₹ rate"
                  className="h-7 w-20 rounded-md border border-border-strong bg-surface-2 px-2 text-right text-[0.75rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            ))}
          </div>
          {resolveMutation.isError && (
            <ErrorNotice message={resolveMutation.error instanceof ApiError ? resolveMutation.error.message : "Couldn't create this page."} />
          )}
          <Button size="sm" onClick={() => resolveMutation.mutate()} disabled={!phone.trim() || resolveMutation.isPending}>
            {resolveMutation.isPending ? "Creating…" : "Create page"}
          </Button>
        </div>
      )}
    </div>
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

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    try {
      const parsed = await parseWorkImportSheet(file);
      if (parsed.length === 0) {
        setParseError('No usable rows found — needs columns for campaign, page, url, and format (e.g. "campaign", "handle", "url", "format").');
      }
      setRows(parsed);
    } catch {
      setParseError("Couldn't read that file — make sure it's a CSV export.");
      setRows([]);
    }
  }

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
            Upload a CSV of posts that already went out — one row each, with the campaign title, page handle, post URL,
            format, and optionally the cost (falls back to the page's rate card if left blank).
          </p>
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
