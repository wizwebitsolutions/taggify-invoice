"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Field, TextField, IntegerField, FieldError } from "@/components/ui/form-field";
import { ErrorNotice } from "@/components/ui/table-parts";
import { admin as adminApi, ApiError } from "@/lib/api-client";

/**
 * Invoices page → Proforma Invoice numbering (user request, 17 Sep —
 * "admin, finance will have power to change invoice no. prefix"). The
 * prefix and the running counter behind the number the plans' "Generate
 * invoice" popup suggests. Admin/Finance only (the page gates the render,
 * the server gates the route).
 */
export function InvoiceNumberingCard({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["invoice-numbering"], queryFn: () => adminApi.invoiceNumbering(token) });
  // null = untouched, so the fields follow the saved values until edited.
  const [prefixInput, setPrefixInput] = useState<string | null>(null);
  const [nextInput, setNextInput] = useState<string | null>(null);
  const prefix = prefixInput ?? query.data?.prefix ?? "";
  const next = nextInput ?? (query.data ? String(query.data.nextNumber) : "");

  const prefixError = !prefix.trim() ? "A prefix is required." : /^[A-Za-z0-9/._-]+$/.test(prefix.trim()) ? null : "Use letters, digits and / . _ - only.";
  const nextError = Number(next) >= 1 ? null : "Enter a number from 1.";
  const dirty = query.data != null && (prefix !== query.data.prefix || Number(next) !== query.data.nextNumber);

  const mutation = useMutation({
    mutationFn: () => adminApi.updateInvoiceNumbering(token, { prefix: prefix.trim(), nextNumber: Number(next) }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["invoice-numbering"], saved);
      queryClient.invalidateQueries({ queryKey: ["plans", "client-invoice-numbering"] });
      setPrefixInput(null);
      setNextInput(null);
    },
  });

  const preview = `${prefix.trim()}${String(Number(next) || 1).padStart(4, "0")}`;

  return (
    <form
      data-testid="invoice-numbering-card"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!prefixError && !nextError && dirty && !mutation.isPending) mutation.mutate();
      }}
    >
      <div>
        <h2 className="text-[0.9375rem] font-semibold">Proforma invoice numbering</h2>
        <p className="text-[0.8125rem] text-text-muted">The number each new client invoice gets from the Plans page. The counter moves up by one per invoice and never resets.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Prefix">
          <TextField aria-label="Invoice number prefix" value={prefix} onChange={setPrefixInput} maxLength={20} placeholder="PI-" disabled={query.isLoading} />
          <FieldError message={query.data ? prefixError : null} />
        </Field>
        <Field label="Next number">
          <IntegerField aria-label="Next invoice number" value={next} onChange={setNextInput} max={99999999} disabled={query.isLoading} />
          <FieldError message={next ? nextError : null} />
        </Field>
        <Button type="submit" disabled={!dirty || Boolean(prefixError) || Boolean(nextError) || mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-[0.78rem] text-text-muted">
        Next invoice: <span className="font-mono font-semibold text-text" data-testid="invoice-numbering-preview">{preview}</span>
      </p>
      {query.isError && <ErrorNotice message="Couldn't load the invoice numbering." />}
      {mutation.isError && <ErrorNotice message={mutation.error instanceof ApiError ? mutation.error.message : "Couldn't save the invoice numbering."} />}
    </form>
  );
}
