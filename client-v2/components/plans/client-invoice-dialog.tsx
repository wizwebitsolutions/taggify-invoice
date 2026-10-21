"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Download } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, plans as plansApi, type Plan, type SavedClient } from "@/lib/api-client";
import { invalidateAfterPlanChange, useSavedClients } from "@/lib/queries/plans";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, inputClass } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/taggify/field";
import { Money } from "@/components/taggify/money";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
/** "+919876543210" → "9876543210": the field holds the 10 local digits, the plan stores +91…. */
const localDigits = (phone?: string | null) => {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
};
/** Same shape v1 checked (client/components/ui/form-field.tsx VALIDATORS.gstin). */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const INVOICE_NUMBER = /^[A-Za-z0-9/._-]+$/;
export const numberingKey = ["plans", "client-invoice-numbering"] as const;

/**
 * Taggify → client invoice for an approved plan (v1 ClientInvoiceModal):
 * billing details prefilled from the plan or a saved client, the invoice
 * number (the counter's next one; Admin/Finance can change it, also when
 * regenerating) and HSN/SAC, then the PDF downloads straight away.
 */
export function ClientInvoiceDialog({ plan, open, onOpenChange }: { plan: Plan; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-lg">{open && <InvoiceFlow plan={plan} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function InvoiceFlow({ plan: p, onClose }: { plan: Plan; onClose: () => void }) {
  const { accessToken, user } = useAuth();
  const qc = useQueryClient();
  const canSetNumber = user?.role === "ADMIN" || user?.role === "FINANCE";

  const [company, setCompany] = useState(p.clientCompany ?? "");
  const [gst, setGst] = useState((p.clientGstNumber ?? "").toUpperCase());
  const [address, setAddress] = useState(p.clientAddress ?? "");
  const [phone, setPhone] = useState(localDigits(p.clientPhone));
  const [description, setDescription] = useState(p.invoiceDescription ?? "");
  // null = untouched: follows the plan's value, then the counter's suggestion / the default HSN.
  const [hsnInput, setHsnInput] = useState<string | null>(p.hsnSac);
  const [numberInput, setNumberInput] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [generated, setGenerated] = useState<Plan | null>(null);

  const numbering = useQuery({ queryKey: numberingKey, queryFn: () => plansApi.invoiceNumbering(accessToken!), enabled: !!accessToken });
  const hsn = hsnInput ?? numbering.data?.defaultHsnSac ?? "";
  const invoiceNumber = numberInput ?? p.clientInvoiceNumber ?? numbering.data?.suggestion ?? "";

  // Saved billing profiles from earlier plans; this plan's own client first.
  const clients = useSavedClients();
  const sameName = (c: SavedClient) => c.clientName.trim().toLowerCase() === p.clientName.trim().toLowerCase();
  const saved = (clients.data ?? []).filter((c) => c.clientCompany || c.clientGstNumber || c.clientAddress).sort((a, b) => Number(sameName(b)) - Number(sameName(a)));
  const [picked, setPicked] = useState("");
  function fillFrom(c: SavedClient) {
    setCompany(c.clientCompany ?? c.clientName);
    setGst((c.clientGstNumber ?? "").toUpperCase());
    setAddress(c.clientAddress ?? "");
    setPhone(localDigits(c.clientPhone));
  }
  // A plan with no billing details yet, for a client invoiced before: fill it in once,
  // never over anything typed. Several profiles under that name: say so instead of guessing.
  const planHasDetails = !!(p.clientCompany || p.clientGstNumber || p.clientAddress);
  const matches = planHasDetails ? [] : saved.filter(sameName);
  const [autoFilledFrom, setAutoFilledFrom] = useState<string | null>(null);
  const autoFillTried = useRef(false);
  useEffect(() => {
    if (autoFillTried.current || !clients.data) return;
    autoFillTried.current = true;
    if (matches.length !== 1 || company || gst || address || phone) return;
    fillFrom(matches[0]);
    setAutoFilledFrom(matches[0].clientCompany ?? matches[0].clientName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients.data]);

  // The GSTIN's state code against ours decides the tax: same state → CGST + SGST, otherwise IGST.
  const gstin = gst.trim().toUpperCase();
  const gstError = !gstin ? "GST number is required." : GSTIN.test(gstin) ? null : "GSTIN is 15 characters, e.g. 27ABCDE1234F1Z5.";
  const stateCode = numbering.data?.companyStateCode;
  const taxNote =
    !p.isGstPlan || !p.gstPercent || gstError || !stateCode
      ? null
      : gstin.slice(0, 2) === stateCode
        ? `Same state as Taggify, so the invoice charges CGST ${p.gstPercent / 2}% + SGST ${p.gstPercent / 2}%.`
        : `Different state from Taggify, so the invoice charges IGST ${p.gstPercent}%.`;
  const errors = {
    number: !canSetNumber ? null : !invoiceNumber.trim() ? "Invoice number is required." : INVOICE_NUMBER.test(invoiceNumber.trim()) ? null : "Use letters, digits and / . _ - only.",
    description: description.trim() ? null : "Description of goods/service is required.",
    company: company.trim() ? null : "Company name is required.",
    gst: gstError,
    address: address.trim() ? null : "Billing address is required.",
    phone: phone.length > 0 && phone.length !== 10 ? "Enter a 10-digit mobile number, or leave it empty." : null,
  };
  const valid = Object.values(errors).every((e) => !e);
  const show = (k: keyof typeof errors) => (touched ? errors[k] : null);

  // Once the POST succeeds the number is minted, so a failed PDF fetch still lands on the success view.
  const download = useMutation({ mutationFn: (n: string | null) => plansApi.downloadClientInvoicePdf(accessToken!, p.id, n) });
  const generate = useMutation({
    mutationFn: () =>
      plansApi.generateClientInvoice(accessToken!, p.id, {
        clientCompany: company.trim(),
        clientGstNumber: gstin,
        clientAddress: address.trim(),
        clientPhone: phone ? `+91${phone}` : "",
        invoiceDescription: description.trim(),
        hsnSac: hsn.trim(),
        // Only Admin/Finance send a number; for everyone else the server keeps the plan's own or takes the next one.
        ...(canSetNumber ? { clientInvoiceNumber: invoiceNumber.trim() } : {}),
      }),
    onSuccess: async (next) => {
      setGenerated(next);
      download.mutate(next.clientInvoiceNumber);
      await invalidateAfterPlanChange(qc);
    },
    // e.g. the number was taken meanwhile: an untouched field moves on to the current suggestion.
    onError: () => qc.invalidateQueries({ queryKey: numberingKey }),
  });

  if (generated)
    return (
      <>
        <DialogHeader>
          <DialogTitle>Invoice generated</DialogTitle>
          <DialogDescription>
            {generated.clientInvoiceNumber} · {p.name}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3 rounded-md bg-success-soft px-4 py-3 text-small" data-testid="client-invoice-generated">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-fg" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">
              Invoice {generated.clientInvoiceNumber} {download.isError ? "was generated." : download.isPending ? "is downloading." : "has downloaded."}
            </p>
            <p className="text-muted-foreground">
              <Money value={generated.overview.total} /> billed to {generated.clientCompany}. The details are saved on the plan. Regenerate any time to reissue it.
            </p>
          </div>
        </div>
        {download.isError && (
          <p className="text-small text-danger-helper" role="alert">
            The PDF didn&apos;t download ({errText(download.error, "network error")}). Try Download again.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={download.isPending} onClick={() => download.mutate(generated.clientInvoiceNumber)}>
            <Download />
            {download.isPending ? "Downloading…" : "Download again"}
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </>
    );

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (valid && !generate.isPending) generate.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{p.clientInvoiceNumber ? "Client invoice details" : "Generate client invoice"}</DialogTitle>
        <DialogDescription>
          {p.name} · billed to {p.clientName} for <Money value={p.overview.total} />
          {p.isGstPlan && p.gstPercent ? ` incl. ${p.gstPercent}% GST` : ""}.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Invoice no." error={show("number")} description={canSetNumber ? undefined : "Set by Admin or Finance."}>
          {(a) => <Input {...a} value={invoiceNumber} readOnly={!canSetNumber} maxLength={40} onChange={(e) => setNumberInput(e.target.value)} />}
        </Field>
        <Field label="HSN/SAC">
          {(a) => <Input {...a} value={hsn} inputMode="numeric" placeholder="998397" onChange={(e) => setHsnInput(e.target.value.replace(/\D/g, "").slice(0, 10))} />}
        </Field>
        <Field label="Description of goods/service" className="sm:col-span-2" error={show("description")}>
          {(a) => (
            <textarea
              {...a}
              rows={2}
              maxLength={300}
              className={cn(inputClass, "h-auto py-2")}
              placeholder="e.g. Influencer marketing services, Instagram reels and stories"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>

        {saved.length > 0 && (
          <Field
            label="Saved client"
            className="sm:col-span-2"
            description={
              autoFilledFrom
                ? `Filled in from ${autoFilledFrom}'s last invoice. Check the details, or edit anything that changed.`
                : matches.length > 1 && !company
                  ? `${p.clientName} has ${matches.length} saved billing profiles. Pick one here.`
                  : "Fills in the billing details below."
            }
          >
            {(a) => (
              <Select
                value={picked}
                onValueChange={(v) => {
                  setPicked(v);
                  fillFrom(saved[Number(v)]);
                  setAutoFilledFrom(null);
                }}
              >
                <SelectTrigger id={a.id} aria-describedby={a["aria-describedby"]}>
                  <SelectValue placeholder="Pick a saved billing profile" />
                </SelectTrigger>
                <SelectContent>
                  {saved.map((c, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {[c.clientCompany ?? c.clientName, c.clientGstNumber].filter(Boolean).join(" · ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        )}

        <Field label="Company name" className="sm:col-span-2" error={show("company")}>
          {(a) => (
            <Input
              {...a}
              value={company}
              placeholder="Acme Foods Pvt Ltd"
              onChange={(e) => {
                setCompany(e.target.value);
                setAutoFilledFrom(null);
              }}
            />
          )}
        </Field>
        <Field label="GST number" className="sm:col-span-2" error={show("gst")} description={taxNote ?? undefined}>
          {(a) => <Input {...a} value={gst} maxLength={15} autoComplete="off" placeholder="27ABCDE1234F1Z5" onChange={(e) => setGst(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15))} />}
        </Field>
        <Field label="Billing address" className="sm:col-span-2" error={show("address")}>
          {(a) => <textarea {...a} rows={2} className={cn(inputClass, "h-auto py-2")} placeholder="Street, city, state, PIN" value={address} onChange={(e) => setAddress(e.target.value)} />}
        </Field>
        <Field label="Phone (optional)" className="sm:col-span-2" error={show("phone")} description="10 digits. We add +91.">
          {(a) => <Input {...a} type="tel" inputMode="numeric" value={phone} placeholder="9876543210" onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} />}
        </Field>
      </div>

      {generate.isError && (
        <p className="text-small text-danger-helper" role="alert">
          {errText(generate.error, "Couldn't generate the invoice. Check the details and try again.")}
        </p>
      )}

      <DialogFooter className="items-center">
        <p className="mr-auto text-small text-muted-foreground">{p.clientInvoiceNumber ? `Reissues ${p.clientInvoiceNumber} with these details.` : "Details are saved on the plan for next time."}</p>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {/* Wait for the suggested number, or an early click reads as "Invoice number is required". */}
        <Button type="submit" disabled={generate.isPending || numbering.isLoading}>
          {generate.isPending ? "Generating…" : numbering.isLoading ? "Loading…" : p.clientInvoiceNumber ? "Regenerate invoice" : "Generate invoice"}
        </Button>
      </DialogFooter>
    </form>
  );
}
