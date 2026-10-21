"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-context";
import { admin as adminApi, ApiError, type InvoiceNumbering } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/taggify/field";
import { LoadError } from "@/components/finance/states";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
/** Same format the server mints (lib/clientInvoiceNumbering.js formatInvoiceNumber): prefix + 4-digit padded counter. */
const preview = (prefix: string, n: number) => `${prefix}${String(n).padStart(4, "0")}`;

/**
 * Client invoice numbering (GET/PUT /admin/invoice-numbering, finance.edit): the
 * prefix and running counter for invoices Taggify sends clients (Receivables).
 * The counter also moves forward by itself when a matching number is typed on a plan.
 */
export function NumberingTab() {
  const { accessToken } = useAuth();
  const q = useQuery({ queryKey: ["invoiceNumbering"], queryFn: () => adminApi.invoiceNumbering(accessToken!), enabled: !!accessToken });

  if (q.isError) return <LoadError onRetry={() => q.refetch()} what="the numbering" />;
  if (!q.data)
    return (
      <div className="flex max-w-xl flex-col gap-4 border-t p-5" aria-busy="true" aria-label="Loading numbering">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  // Keyed by the saved values so the form starts again from what the server stored.
  return <NumberingForm key={`${q.data.prefix}:${q.data.nextNumber}`} saved={q.data} />;
}

function NumberingForm({ saved }: { saved: InvoiceNumbering }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const [prefix, setPrefix] = useState(saved.prefix);
  const [next, setNext] = useState(String(saved.nextNumber));

  const n = Number(next);
  const prefixError = !prefix.trim() ? "A prefix is needed." : !/^[A-Za-z0-9/._-]+$/.test(prefix.trim()) ? "Use letters, digits and / . _ - only." : null;
  const nextError = !/^\d+$/.test(next) || n < 1 || n > 99_999_999 ? "Enter a whole number from 1 to 99,999,999." : null;
  const changed = prefix.trim() !== saved.prefix || n !== saved.nextNumber;
  const goingBack = !nextError && prefix.trim() === saved.prefix && n < saved.nextNumber;

  const save = useMutation({
    mutationFn: () =>
      adminApi.updateInvoiceNumbering(accessToken!, {
        ...(prefix.trim() !== saved.prefix ? { prefix: prefix.trim() } : {}),
        ...(n !== saved.nextNumber ? { nextNumber: n } : {}),
      }),
    onSuccess: (r) => {
      qc.setQueryData(["invoiceNumbering"], r);
      toast.success(`Saved. The next client invoice will be ${r.suggestion}.`);
    },
    onError: (e) => toast.error(errText(e, "Couldn't save the numbering.")),
  });

  return (
    <form
      className="flex max-w-xl flex-col gap-5 border-t p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!prefixError && !nextError && changed) save.mutate();
      }}
    >
      <p className="text-body text-muted-foreground">For invoices Taggify sends clients (Receivables). Every number is the prefix plus a counter that goes up by one each time.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prefix" error={prefixError} description="Up to 20 characters, like TGF/26-27/.">
          {(a) => <Input {...a} value={prefix} maxLength={20} onChange={(e) => setPrefix(e.target.value)} autoComplete="off" />}
        </Field>
        <Field label="Next number" error={nextError}>
          {(a) => <Input {...a} inputMode="numeric" value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, "").slice(0, 8))} autoComplete="off" />}
        </Field>
      </div>
      <div className="rounded-card border bg-muted/60 px-4 py-3">
        <p className="text-small text-muted-foreground">Next client invoice</p>
        <p className="num text-h3 font-bold" data-testid="numbering-preview">
          {prefixError || nextError ? "—" : preview(prefix.trim(), n)}
        </p>
      </div>
      {goingBack && (
        <p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-small text-warning-fg">
          This goes back from {saved.suggestion}. Numbers from {preview(saved.prefix, n)} on may already be on issued invoices, and a repeat will be refused when the invoice is made.
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!changed || !!prefixError || !!nextError || save.isPending}>
          {save.isPending ? "Saving…" : "Save numbering"}
        </Button>
        {changed && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setPrefix(saved.prefix);
              setNext(String(saved.nextNumber));
            }}
          >
            Undo changes
          </Button>
        )}
      </div>
    </form>
  );
}
