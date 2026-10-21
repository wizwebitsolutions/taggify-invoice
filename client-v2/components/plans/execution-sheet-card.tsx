"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleCheck, ExternalLink, Plus, RefreshCw } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, plans as plansApi, type Plan } from "@/lib/api-client";
import { plural } from "@/lib/format";
import { invalidateAfterPlanChange } from "@/lib/queries/plans";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExecutionSheetFormat, ExecutionSheetFormatDialog } from "@/components/plans/execution-sheet-format-dialog";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** v1 execution-sheet-modal's link rules: a Google Sheets link, up to 500 characters (server: z.string().url().max(500)). */
function linkError(raw: string) {
  const v = raw.trim();
  if (!v) return "Paste the sheet's link.";
  if (!/^https?:\/\/\S+$/i.test(v)) return "Enter a full link starting with https://";
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\//i.test(v)) return "Only Google Sheets links work here: https://docs.google.com/spreadsheets/…";
  if (v.length > 500) return "That link is too long (500 characters at most).";
  return null;
}

/**
 * Plan detail → Execution sheet (v1 parity, 13 Oct): the Google Sheet that
 * tracks what was actually posted. Any plan can have one attached; once the
 * plan is approved the sheet is read on attach and on "Refresh links", and
 * rows with a posted link become posts for each page's owner. Two states, as
 * in v1: a dashed "Attach execution sheet" prompt, or an attached sheet with
 * what the last read found.
 */
export function ExecutionSheetCard({ plan: p, editable }: { plan: Plan; editable: boolean }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const [attachOpen, setAttachOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const approved = p.status === "APPROVED";
  const pending = p.executionSheetPending ?? [];

  const sync = useMutation({
    mutationFn: () => plansApi.syncExecutionSheet(accessToken!, p.id),
    onSuccess: async () => {
      await invalidateAfterPlanChange(qc);
      await qc.invalidateQueries({ queryKey: ["links"] });
    },
  });
  const summary = sync.data?.summary;

  return (
    <Card className="p-5" data-testid="execution-sheet-card">
      <h2 className="mb-1 text-card-title">Execution sheet</h2>
      <p className="mb-3 text-small text-muted-foreground">
        The sheet tracking what was actually posted. Once the plan is approved, each row with a post link becomes a post for that page&apos;s owner.{" "}
        <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setFormatOpen(true)}>
          See the sheet format
        </Button>
      </p>

      {!p.executionSheetUrl ? (
        editable ? (
          <button
            type="button"
            onClick={() => setAttachOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-3 text-small font-semibold text-fg-muted transition-colors duration-hover hover:border-brand hover:text-foreground"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Attach execution sheet
          </button>
        ) : (
          <p className="rounded-md bg-muted px-3 py-2 text-small text-muted-foreground">No execution sheet attached yet.</p>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 rounded-md bg-success-soft px-3 py-2">
            <a href={p.executionSheetUrl} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 text-small font-semibold text-success-fg hover:text-success-fg">
              <CircleCheck className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">Execution sheet attached · Open</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </a>
            {editable && (
              <Button variant="link" size="sm" className="h-auto shrink-0 px-0" onClick={() => setAttachOpen(true)}>
                Change
              </Button>
            )}
          </div>

          {!approved ? (
            <p className="text-small text-muted-foreground">Posted links are read from this sheet once the plan is approved.</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2" data-testid="execution-sheet-sync">
              <p className="text-small text-muted-foreground">
                {p.executionSheetFetchedAt ? `Links read ${when(p.executionSheetFetchedAt)}${pending.length > 0 ? ` · ${plural(pending.length, "row")} pending` : ""}` : "Not read yet."}
              </p>
              {editable && (
                <Button size="sm" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>
                  <RefreshCw className={sync.isPending ? "motion-safe:animate-spin" : undefined} />
                  {sync.isPending ? "Reading…" : "Refresh links"}
                </Button>
              )}
            </div>
          )}

          {summary && (
            <p className="text-small text-foreground" role="status" data-testid="execution-sheet-summary">
              Attached {plural(summary.attached, "new link")}
              {summary.alreadyLinked > 0 ? ` · ${summary.alreadyLinked} already linked` : ""}
              {summary.pending > 0 ? ` · ${summary.pending} pending` : ""}
            </p>
          )}
          {sync.isError && (
            <p className="text-small text-danger-helper" role="alert">
              {errText(sync.error, "Couldn't read the execution sheet. Check it's shared and try again.")}
            </p>
          )}

          {approved && pending.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-md border border-dashed px-3 py-2 text-small" data-testid="execution-sheet-pending">
              {pending.slice(0, 5).map((r) => (
                <li key={r.rowNumber} className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 text-fg-muted">Row {r.rowNumber}</span>
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{r.pageHandle ?? r.pageName ?? "Unknown page"}</span> · {r.reason}
                  </span>
                </li>
              ))}
              {pending.length > 5 && <li className="text-fg-muted">+ {pending.length - 5} more in the sheet</li>}
            </ul>
          )}
        </div>
      )}

      {editable && <AttachExecutionSheetDialog plan={p} open={attachOpen} onClose={() => setAttachOpen(false)} />}
      <ExecutionSheetFormatDialog open={formatOpen} onOpenChange={setFormatOpen} canCopy={editable} />
    </Card>
  );
}

/** Step 2 of v1's attach flow: what the sheet must look like (with the template), then the link. */
function AttachExecutionSheetDialog({ plan: p, open, onClose }: { plan: Plan; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-3xl">{open && <AttachForm plan={p} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function AttachForm({ plan: p, onClose }: { plan: Plan; onClose: () => void }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const [url, setUrl] = useState(p.executionSheetUrl ?? "");
  const [touched, setTouched] = useState(false);
  const error = linkError(url);

  const save = useMutation({
    mutationFn: (next: string | null) => plansApi.update(accessToken!, p.id, { executionSheetUrl: next }),
    onSuccess: async (updated, next) => {
      await invalidateAfterPlanChange(qc);
      await qc.invalidateQueries({ queryKey: ["links"] });
      // The link is saved even when an approved plan's sheet can't be read yet; say so.
      if (updated.executionSheetSyncError) toast.error(`Sheet attached, but it couldn't be read: ${updated.executionSheetSyncError}`);
      else toast.success(next ? (p.status === "APPROVED" ? "Execution sheet attached and read." : "Execution sheet attached.") : "Execution sheet removed.");
      onClose();
    },
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (error || save.isPending) return;
        save.mutate(url.trim());
      }}
    >
      <DialogHeader>
        <DialogTitle>{p.executionSheetUrl ? "Change execution sheet" : "Attach execution sheet"}</DialogTitle>
        <DialogDescription>{p.name} · the sheet tracking what was actually posted.</DialogDescription>
      </DialogHeader>

      <section className="flex flex-col gap-2">
        <h3 className="text-label uppercase tracking-wide text-fg-muted">Supported format</h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-muted-foreground">
          <li>
            A <span className="font-semibold text-foreground">Google Sheets link</span> (docs.google.com/spreadsheets/…), not an uploaded Excel or PDF file.
          </li>
          <li>
            Shared as <span className="font-semibold text-foreground">“Anyone with the link can view”</span>, so the app can read it.
          </li>
          <li>One row per published post, with these columns in this order, and a TOTAL row at the end:</li>
        </ul>
        <ExecutionSheetFormat canCopy />
      </section>

      <div className="flex flex-col gap-2">
        <Label htmlFor="execution-sheet-url">Execution sheet link</Label>
        <Input
          id="execution-sheet-url"
          type="url"
          autoFocus
          placeholder="https://docs.google.com/spreadsheets/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={touched && !!error}
          aria-describedby={touched && error ? "execution-sheet-url-error" : undefined}
        />
        {touched && error && (
          <p id="execution-sheet-url-error" className="text-small text-danger-helper">
            {error}
          </p>
        )}
        {p.status === "APPROVED" && <p className="text-caption text-muted-foreground">The plan is approved, so the sheet is read as soon as it&apos;s attached.</p>}
      </div>

      {save.isError && (
        <p className="text-small text-danger-helper" role="alert">
          {errText(save.error, "Couldn't save that link.")}
        </p>
      )}

      <DialogFooter className="gap-2 sm:justify-between">
        {p.executionSheetUrl ? (
          <Button type="button" variant="ghost" className="text-danger-fg" disabled={save.isPending} onClick={() => save.mutate(null)}>
            Remove sheet
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Attach sheet"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
