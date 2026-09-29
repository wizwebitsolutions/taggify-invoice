"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field } from "@/components/ui/form-field";
import { ComboInput, type ComboSuggestion } from "@/components/ui/combo-input";
import { ClientInvoicesPanel } from "@/components/invoices/client-invoices-panel";
import { clientInvoices as clientInvoicesApi } from "@/lib/api-client";

type ClientIdentity = { clientName: string; clientCompany: string | null; clientGstNumber: string | null };

/**
 * "Attach an invoice" (25 Sep — Receivables' own entry point, so attaching
 * doesn't require first hunting down the right plan on the Plans page):
 * pick a client, then see every invoice billed to them — including ones
 * with no real invoice attached yet, which the (now attached-only, see
 * app/invoices/page.tsx) Receivables list no longer shows on its own.
 *
 * Deliberately built on `clientInvoices.list` (unfiltered) rather than
 * `/plans/clients` — that "saved clients" endpoint is gated on `plans.view`,
 * which a plain FINANCE account (the exact user this modal is for) doesn't
 * hold by default; `clientInvoices.list` is the same list Finance already
 * sees on the tab behind this modal. It's also the more correct source: a
 * client with zero invoices ever isn't relevant to an "attach an invoice" flow.
 */
export function AttachInvoiceModal({ token, canManage, onClose }: { token: string; canManage: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ClientIdentity | null>(null);

  // Unfiltered — every invoice this account can see, attached or not, so the
  // picker's client list isn't blind to the very rows this modal exists to find.
  const invoicesQuery = useQuery({ queryKey: ["client-invoices", "all-for-picker"], queryFn: () => clientInvoicesApi.list(token, {}) });
  const clients = useMemo(() => {
    const byIdentity = new Map<string, ClientIdentity>();
    for (const ci of invoicesQuery.data?.items ?? []) {
      const plan = ci.plan;
      if (!plan) continue;
      const key = `${plan.clientName.trim().toLowerCase()}|${(plan.clientGstNumber ?? plan.clientCompany ?? "").trim().toLowerCase()}`;
      if (!byIdentity.has(key)) byIdentity.set(key, { clientName: plan.clientName, clientCompany: plan.clientCompany, clientGstNumber: plan.clientGstNumber });
    }
    return [...byIdentity.values()];
  }, [invoicesQuery.data]);
  const suggestions: ComboSuggestion[] = clients.map((c, i) => ({
    key: String(i),
    label: c.clientCompany ?? c.clientName,
    hint: [c.clientCompany ? c.clientName : null, c.clientGstNumber].filter(Boolean).join(" · "),
  }));

  function pickByIndex(index: string) {
    const client = clients[Number(index)];
    if (client) setPicked(client);
  }

  const searchTerm = picked ? (picked.clientCompany ?? picked.clientName) : "";

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[880px]">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6 pt-1" data-testid="attach-invoice-modal">
        <div>
          <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">Attach an invoice</h2>
          <p className="mt-1 text-[0.8125rem] text-text-muted">Pick a client to see every plan billed to them, including ones still waiting on their real invoice.</p>
        </div>

        {!picked ? (
          <Field label="Client">
            <ComboInput
              value={query}
              onChange={setQuery}
              onPick={(s) => pickByIndex(s.key)}
              suggestions={suggestions}
              placeholder="Search by company, client name or GSTIN…"
              aria-label="Client"
            />
            {invoicesQuery.isError && <p className="mt-1.5 text-[0.75rem] text-rose">Couldn't load clients — try again.</p>}
          </Field>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[0.875rem] font-semibold">{picked.clientCompany ?? picked.clientName}</p>
                {picked.clientGstNumber && <p className="truncate font-mono text-[0.75rem] text-text-faint">{picked.clientGstNumber}</p>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
                Change client
              </Button>
            </div>
            {/* Unfiltered on purpose — an unattached invoice is exactly what this flow exists to find. */}
            <ClientInvoicesPanel token={token} canManage={canManage} showAttachmentControl initialSearch={searchTerm} searchPlaceholder="Search this client's invoices…" />
          </>
        )}

        <div className="mt-auto flex justify-end border-t border-border pt-4">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
