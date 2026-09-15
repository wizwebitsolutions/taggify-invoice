"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Field, TextField, TextArea, PhoneField, FieldError, VALIDATORS } from "@/components/ui/form-field";
import { ErrorNotice } from "@/components/ui/table-parts";
import { CheckCircleIcon, DownloadIcon } from "@/components/icons";
import { plans as plansApi, ApiError, type Plan } from "@/lib/api-client";
import { money } from "@/lib/format";

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
  const [touched, setTouched] = useState(false);
  const [generated, setGenerated] = useState<Plan | null>(null);

  const gstRequired = plan.isGstPlan;
  const errors = {
    company: company.trim() ? null : "Company name is required.",
    gst: gstRequired && !gst.trim() ? "This is a GST plan — the client's GST number goes on the invoice." : VALIDATORS.gstin(gst.trim().toUpperCase()),
    address: address.trim() ? null : "Billing address is required.",
    phone: phone.length > 0 && phone.length !== 10 ? "Enter a valid 10-digit mobile number." : null,
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
      }),
    onSuccess: (updated) => {
      setGenerated(updated);
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      downloadMutation.mutate(updated.clientInvoiceNumber);
    },
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
              : `${plan.name} · billed to ${plan.clientName} for ${money(plan.overview.total)}${plan.isGstPlan ? " incl. 18% GST" : ""}.`}
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
            <Field label="Company name">
              <TextField value={company} onChange={setCompany} placeholder="Acme Foods Pvt Ltd" autoFocus name="clientCompany" aria-invalid={touched && Boolean(errors.company)} />
              {touched && <FieldError message={errors.company} />}
            </Field>
            <Field label={gstRequired ? "GST number" : "GST number (optional)"}>
              <TextField value={gst} onChange={(v) => setGst(v.toUpperCase())} placeholder="27ABCDE1234F1Z5" maxLength={15} name="clientGstNumber" aria-invalid={touched && Boolean(errors.gst)} />
              {touched && <FieldError message={errors.gst} />}
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
