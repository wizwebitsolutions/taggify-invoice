"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, ExternalLink } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, needsGoogleReconnect, plans as plansApi } from "@/lib/api-client";
import { count } from "@/lib/format";
import { downloadCsv } from "@/lib/plan-sheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * What the execution sheet must look like (GET /plans/execution-sheet-template/preview, the same
 * sample the server builds), as a table, a .csv, or a live Google Sheet copy (POST
 * /plans/execution-sheet-template, plans.edit and the workspace's Google connection; the .csv
 * always works without Google). Shown in the format dialog and in the attach dialog (v1 parity).
 */
export function ExecutionSheetFormat({ canCopy, enabled = true }: { canCopy: boolean; enabled?: boolean }) {
  const { accessToken } = useAuth();
  const template = useQuery({ queryKey: ["plans", "execution-sheet-template"], queryFn: () => plansApi.previewExecutionSheetTemplate(accessToken!), enabled: enabled && !!accessToken, staleTime: Infinity });
  const t = template.data;
  // The tab is opened inside the click and pointed at the sheet afterwards; a window.open after the await would be popup-blocked.
  const copy = useMutation({
    mutationFn: async (tab: Window | null) => {
      try {
        const { spreadsheetUrl } = await plansApi.getExecutionSheetTemplate(accessToken!);
        tab?.location.assign(spreadsheetUrl);
      } catch (err) {
        tab?.close();
        throw err;
      }
    },
  });
  const copyError = copy.error
    ? needsGoogleReconnect(copy.error)
      ? "Google isn't connected for this workspace. An admin can connect it in Settings; the .csv works without it."
      : copy.error instanceof ApiError
        ? `${copy.error.message} The .csv works without Google.`
        : "Couldn't open the Google Sheet. The .csv works without Google."
    : null;

  return (
    <div className="flex flex-col gap-3" data-testid="execution-sheet-format">
      {template.isError ? (
        <p className="text-small text-danger-helper" role="alert">
          Couldn&apos;t load the sample. Try again.
        </p>
      ) : !t ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="max-h-80 overflow-auto rounded-card border">
          <Table>
            <TableHeader>
              <TableRow>
                {t.headers.map((h) => (
                  <TableHead key={h} className="whitespace-nowrap">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.rows.map((row, r) => (
                <TableRow key={r}>
                  {row.map((cell, c) => (
                    <TableCell key={c} className="max-w-40 truncate whitespace-nowrap">
                      {typeof cell === "number" && c > 0 ? count(cell) : cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow className="bg-muted font-semibold">
                {t.totalsRow.map((cell, c) => (
                  <TableCell key={c} className="whitespace-nowrap">
                    {typeof cell === "number" ? count(cell) : cell}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!t} onClick={() => t && downloadCsv([t.headers, ...t.rows, t.totalsRow], "taggify-execution-sheet-template.csv")}>
          <Download />
          Download template (.csv)
        </Button>
        {canCopy && (
          <Button type="button" variant="ghost" size="sm" disabled={copy.isPending} onClick={() => copy.mutate(window.open("", "_blank"))}>
            <ExternalLink />
            {copy.isPending ? "Opening…" : "Open as Google Sheet"}
          </Button>
        )}
      </div>
      <p className="text-caption text-muted-foreground">Using the .csv: in Google Sheets choose File → Import → Upload, fill it in, then paste that sheet&apos;s link on the plan.</p>
      {copyError && (
        <p className="text-small text-danger-helper" role="alert">
          {copyError}
        </p>
      )}
    </div>
  );
}

/** Plan detail → Execution sheet → "See the sheet format" (for anyone who can't attach one). */
export function ExecutionSheetFormatDialog({ open, onOpenChange, canCopy }: { open: boolean; onOpenChange: (o: boolean) => void; canCopy: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Execution sheet format</DialogTitle>
          <DialogDescription>A Google Sheet shared as “Anyone with the link can view”, one row per published post, these columns in this order, and a TOTAL row at the end.</DialogDescription>
        </DialogHeader>
        <ExecutionSheetFormat canCopy={canCopy} enabled={open} />
      </DialogContent>
    </Dialog>
  );
}
