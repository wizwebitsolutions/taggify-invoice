"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ComboInput, type ComboSuggestion } from "@/components/ui/combo-input";
import { Field, TextField, TextArea, PhoneField, FieldError, VALIDATORS } from "@/components/ui/form-field";
import { ErrorNotice } from "@/components/ui/table-parts";
import { CheckCircleIcon, DownloadIcon } from "@/components/icons";
import { plans as plansApi, ApiError, type Plan, type SavedClient } from "@/lib/api-client";
import { money } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";

/**
 * Plans page → "Generate invoice" (user request, 13 Sep — "on clicking
 * generate invoice, it'll ask for client details like gst, company
 * address, phone number etc ... in separate ui popup"). Collects the
 * client's billing details, prefilled from what the plan already holds,
 * saves them onto the plan and generates the Taggify → client invoice for
 * the plan's client-facing total, then hands the PDF to the browser.
 *
 * Distinct from the creators' own payout invoices (those are raised by
 * each creator from /invoices) — this is the one the *client* pays.
 */
export function ClientInvoiceModal({ token, plan, onClose }: { token: string; plan: Plan; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [company, setCompany] = useState(plan.clientCompany ?? "");
  const [gst, setGst] = useState(plan.clientGstNumber ?? "");
  const [address, setAddress] = useState(plan.clientAddress ?? "");
  // PhoneField holds the 10 national digits; the plan stores "+91XXXXXXXXXX".
  const [phone, setPhone] = useState(digitsOfPhone(plan.clientPhone));

  // Saved clients (21 Sep — "if client name already exists ... it should
  // fetch all details like gst, address ... dropdown of client name"). Only
  // entries that actually carry billing details are worth offering here;
  // this plan's own client sorts first.
  const clientsQuery = useQuery({ queryKey: ["plans", "clients"], queryFn: () => plansApi.clients(token) });
  const sameName = (c: SavedClient) => c.clientName.trim().toLowerCase() === plan.clientName.trim().toLowerCase();
  const savedClients = (clientsQuery.data ?? [])
    .filter((c) => c.clientCompany || c.clientGstNumber || c.clientAddress)
    .sort((a, b) => Number(sameName(b)) - Number(sameName(a)));
  const suggestions: ComboSuggestion[] = savedClients.map((c, i) => ({
    key: String(i),
    label: c.clientCompany ?? c.clientName,
    hint: [c.clientCompany ? c.clientName : null, c.clientGstNumber, c.clientAddress].filter(Boolean).join(" · "),
  }));
  function fillFrom(c: SavedClient) {
    setCompany(c.clientCompany ?? c.clientName);
    setGst((c.clientGstNumber ?? "").toUpperCase());
    setAddress(c.clientAddress ?? "");
    setPhone(digitsOfPhone(c.clientPhone));
  }
  // A plan with nothing saved yet, for a client invoiced before: fill it in
  // without being asked — once, and never over anything already typed.
  // With several billing identities under that name (one brand, different
  // GST registrations) there's no right guess, so it says so instead.
  const planHasDetails = Boolean(plan.clientCompany || plan.clientGstNumber || plan.clientAddress);
  const matches = planHasDetails ? [] : savedClients.filter(sameName);
  const [autoFilledFrom, setAutoFilledFrom] = useState<string | null>(null);
  const autoFillTried = useRef(false);
  useEffect(() => {
    if (autoFillTried.current || !clientsQuery.data) return;
    autoFillTried.current = true;
    if (matches.length !== 1 || company || gst || address || phone) return;
    fillFrom(matches[0]);
    setAutoFilledFrom(matches[0].clientCompany ?? matches[0].clientName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientsQuery.data]);

  // 17 Sep — "description of goods, invoice no. to be set in last step when
  // taking client details": the PI's one description line, its HSN/SAC, and
  // the invoice number (the counter's next one, editable by Admin/Finance).
  const { user } = useAuth();
  const canSetNumber = user?.role === "ADMIN" || user?.role === "FINANCE";
  const numberingQuery = useQuery({ queryKey: ["plans", "client-invoice-numbering"], queryFn: () => plansApi.invoiceNumbering(token) });
  const [description, setDescription] = useState(plan.invoiceDescription ?? "");
  // null = untouched, so the field follows the plan's number / the counter's
  // suggestion / the company default HSN until the user actually types.
  const [hsnInput, setHsnInput] = useState<string | null>(plan.hsnSac);
  const [numberInput, setNumberInput] = useState<string | null>(null);
  const hsn = hsnInput ?? numberingQuery.data?.defaultHsnSac ?? "";
  const invoiceNumber = numberInput ?? plan.clientInvoiceNumber ?? numberingQuery.data?.suggestion ?? "";
  const [touched, setTouched] = useState(false);
  const [generated, setGenerated] = useState<Plan | null>(null);

  // 21 Sep — "gst no. is mandatory", GST plan or not. Its first two digits
  // (the state code) against ours decide what the PI charges: same state →
  // CGST + SGST at half the rate each, any other → IGST (server: lib/gstin.js).
  const gstin = gst.trim().toUpperCase();
  const gstError = gstin ? VALIDATORS.gstin(gstin) : "GST number is required.";
  const companyStateCode = numberingQuery.data?.companyStateCode;
  const taxNote =
    !plan.isGstPlan || !plan.gstPercent || gstError || !companyStateCode
      ? null
      : gstin.slice(0, 2) === companyStateCode
      ? `Same state as Taggify — the invoice charges CGST ${plan.gstPercent / 2}% + SGST ${plan.gstPercent / 2}%.`
      : `Different state from Taggify — the invoice charges IGST ${plan.gstPercent}%.`;
  const errors = {
    company: company.trim() ? null : "Company name is required.",
    gst: gstError,
    address: address.trim() ? null : "Billing address is required.",
    phone: phone.length > 0 && phone.length !== 10 ? "Enter a valid 10-digit mobile number." : null,
    description: description.trim() ? null : "Description of goods/service is required.",
    // Only validated for whoever may type it — for everyone else the server picks the number.
    invoiceNumber: !canSetNumber ? null : !invoiceNumber.trim() ? "Invoice number is required." : /^[A-Za-z0-9/._-]+$/.test(invoiceNumber.trim()) ? null : "Use letters, digits and / . _ - only.",
  };
  const valid = Object.values(errors).every((e) => !e);

  // Two steps, two error states: once the POST succeeds the number is
  // minted and the details are saved server-side, so a failed PDF fetch
  // after that must still land on the success view (with its own error
  // and a "Download again") rather than pretending nothing was generated.
  const downloadMutation = useMutation({
    mutationFn: (invoiceNumber: string | null) => plansApi.downloadClientInvoicePdf(token, plan.id, invoiceNumber),
  });
  const generateMutation = useMutation({
    mutationFn: () =>
      plansApi.generateClientInvoice(token, plan.id, {
        clientCompany: company.trim(),
        clientGstNumber: gst.trim().toUpperCase(),
        clientAddress: address.trim(),
        clientPhone: phone ? `+91${phone}` : "",
        invoiceDescription: description.trim(),
        hsnSac: hsn.trim(),
        // Only Admin/Finance send a number; everyone else gets the plan's
        // own / the counter's next one server-side.
        ...(canSetNumber ? { clientInvoiceNumber: invoiceNumber.trim() } : {}),
      }),
    onSuccess: (updated) => {
      setGenerated(updated);
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-numbering"] });
      // The Receivables view in /invoices lists this row (23 Sep).
      queryClient.invalidateQueries({ queryKey: ["client-invoices"] });
      downloadMutation.mutate(updated.clientInvoiceNumber);
    },
    // e.g. INVOICE_NUMBER_TAKEN — refetch so an untouched field moves on to
    // the current suggestion instead of resending the stale one.
    onError: () => queryClient.invalidateQueries({ queryKey: ["plans", "client-invoice-numbering"] }),
  });

  const submit = () => {
    setTouched(true);
    if (!valid || generateMutation.isPending) return;
    generateMutation.mutate();
  };

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-[520px]">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6 pt-1" data-testid="client-invoice-modal">
        <div>
          <h2 className="text-[1.125rem] font-semibold tracking-[-0.02em]">{generated ? "Invoice generated" : "Generate invoice"}</h2>
          <p className="text-[0.8125rem] text-text-muted">
            {generated
              ? `${generated.clientInvoiceNumber} · ${plan.name}`
              : `${plan.name} · billed to ${plan.clientName} for ${money(plan.overview.total)}${plan.isGstPlan ? ` incl. ${plan.gstPercent}% GST` : ""}.`}
          </p>
        </div>

        {generated ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-md border border-accent/25 bg-accent-soft px-4 py-3 text-[0.8125rem]" data-testid="client-invoice-generated">
              <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div className="flex flex-col gap-0.5">
                <p className="font-semibold">Invoice {generated.clientInvoiceNumber} {downloadMutation.isError ? "was generated." : "is downloading."}</p>
                <p className="text-text-muted">
                  {money(generated.overview.total)} billed to {generated.clientCompany}. The client details are saved on the plan — regenerate any time to reissue with the same number.
                </p>
              </div>
            </div>
            {downloadMutation.isError && <ErrorNotice message={`The PDF didn't download${downloadMutation.error instanceof ApiError ? ` (${downloadMutation.error.message})` : ""} — try "Download again".`} />}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => downloadMutation.mutate(generated.clientInvoiceNumber)} disabled={downloadMutation.isPending}>
                <DownloadIcon className="h-3.5 w-3.5" />
                {downloadMutation.isPending ? "Downloading…" : "Download again"}
              </Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            noValidate
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Invoice no.">
                <TextField
                  value={invoiceNumber}
                  onChange={setNumberInput}
                  name="clientInvoiceNumber"
                  aria-label="Invoice number"
                  maxLength={40}
                  readOnly={!canSetNumber}
                  aria-invalid={touched && Boolean(errors.invoiceNumber)}
                />
                {touched && <FieldError message={errors.invoiceNumber} />}
                {!canSetNumber && <p className="text-[0.72rem] text-text-faint">Set by Admin / Finance.</p>}
              </Field>
              <Field label="HSN/SAC">
                <TextField value={hsn} onChange={(v) => setHsnInput(v.replace(/\D/g, "").slice(0, 10))} name="hsnSac" aria-label="HSN/SAC" inputMode="numeric" placeholder="998397" />
              </Field>
            </div>
            <Field label="Description of goods/service">
              <TextArea
                value={description}
                onChange={setDescription}
                name="invoiceDescription"
                aria-label="Description of goods/service"
                placeholder="e.g. Influencer marketing services — Instagram reels and stories"
                maxLength={300}
                rows={2}
                aria-invalid={touched && Boolean(errors.description)}
              />
              {touched && <FieldError message={errors.description} />}
            </Field>
            <Field label="Company name">
              <ComboInput
                value={company}
                onChange={(v) => {
                  setCompany(v);
                  setAutoFilledFrom(null);
                }}
                onPick={(picked) => {
                  fillFrom(savedClients[Number(picked.key)]);
                  setAutoFilledFrom(null);
                }}
                suggestions={suggestions}
                placeholder="Acme Foods Pvt Ltd"
                autoFocus
                name="clientCompany"
                aria-label="Company name"
                aria-invalid={touched && Boolean(errors.company)}
              />
              {touched && <FieldError message={errors.company} />}
              {autoFilledFrom ? (
                <p className="text-[0.72rem] text-text-faint" data-testid="client-invoice-autofill-note">
                  Filled in from {autoFilledFrom}&apos;s last invoice — check the details, or edit anything that changed.
                </p>
              ) : matches.length > 1 && !company ? (
                <p className="text-[0.72rem] text-text-faint" data-testid="client-invoice-autofill-note">
                  {plan.clientName} has {matches.length} saved billing profiles — pick one from this field&apos;s list.
                </p>
              ) : null}
            </Field>
            <Field label="GST number">
              <TextField value={gst} onChange={(v) => setGst(v.toUpperCase())} placeholder="27ABCDE1234F1Z5" maxLength={15} name="clientGstNumber" aria-invalid={touched && Boolean(errors.gst)} />
              {touched && <FieldError message={errors.gst} />}
              {taxNote && (
                <p className="text-[0.72rem] text-text-faint" data-testid="client-invoice-tax-note">
                  {taxNote}
                </p>
              )}
            </Field>
            <Field label="Company address">
              <TextArea value={address} onChange={setAddress} placeholder="Street, city, state, PIN" name="clientAddress" aria-invalid={touched && Boolean(errors.address)} />
              {touched && <FieldError message={errors.address} />}
            </Field>
            <Field label="Phone number (optional)">
              <PhoneField value={phone} onChange={setPhone} placeholder="9876543210" name="clientPhone" error={touched ? errors.phone : undefined} />
            </Field>

            {generateMutation.isError && (
              <ErrorNotice message={generateMutation.error instanceof ApiError ? generateMutation.error.message : "Couldn't generate this invoice."} />
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="text-[0.75rem] text-text-faint">
                {plan.clientInvoiceNumber ? `Reissues ${plan.clientInvoiceNumber} with these details.` : "Details are saved on the plan for next time."}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={generateMutation.isPending}>
                  {generateMutation.isPending ? "Generating…" : plan.clientInvoiceNumber ? "Regenerate invoice" : "Generate invoice"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </Sheet>
  );
}

function digitsOfPhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}
