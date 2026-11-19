"use client";

import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth-context";
import { canUse, clientInvoices as clientInvoicesApi, invoices as invoicesApi, plans as plansApi, type Invoice, type Plan } from "@/lib/api-client";
import { uploadSigned } from "@/lib/attachments";
import { AttachmentField } from "@/components/taggify/attachment-field";

/**
 * The creator's own invoice document on an Invoice (their GST invoice PDF),
 * kept next to the one Taggify generates. POST/DELETE /invoices/:id/attachment
 * need finance.edit (own-scope for creators) and are refused once it's paid.
 */
export function InvoiceAttachmentField({ invoice, compact, attachLabel = "Attach the creator's invoice" }: { invoice: Invoice; compact?: boolean; attachLabel?: string }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const paid = invoice.status === "PAID";
  const refresh = () => qc.invalidateQueries({ queryKey: ["invoices"] });
  return (
    <AttachmentField
      attachment={invoice.attachment}
      readOnly={paid || !canUse(user, "finance.edit")}
      readOnlyNote={paid && !compact ? "Paid invoices can't change." : undefined}
      attachLabel={attachLabel}
      what="invoice file"
      compact={compact}
      onUpload={async (file) => {
        const publicId = await uploadSigned(await invoicesApi.requestAttachmentUpload(accessToken!, invoice.id), file);
        await invoicesApi.confirmAttachment(accessToken!, invoice.id, publicId, file.name);
        await refresh();
      }}
      onRemove={async () => {
        await invoicesApi.removeAttachment(accessToken!, invoice.id);
        await refresh();
      }}
    />
  );
}

/**
 * The client invoice PDF on a Plan (e.g. one raised outside Taggify). PDF only.
 * /plans/:id/invoice-attachment needs plans.edit or the planner who owns it,
 * the same rule as editing the plan (`editable`); any status, since an
 * invoice raised elsewhere can exist before the plan is approved. Takes the
 * slimmer plan on a ClientInvoice too (Receivables rows, compact).
 * `via="finance"` (19 Nov) uses /invoices/plans/:id/final-invoice instead:
 * Finance (finance.edit) uploads on an approved plan without plan access.
 */
export function PlanInvoiceAttachmentField({ plan, editable, compact, via = "plan" }: { plan: Pick<Plan, "id" | "invoiceAttachment">; editable: boolean; compact?: boolean; via?: "plan" | "finance" }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["plans"] }), qc.invalidateQueries({ queryKey: ["clientInvoices"] }), qc.invalidateQueries({ queryKey: ["plansToInvoice"] })]);
  const api =
    via === "finance"
      ? { request: clientInvoicesApi.requestFinalInvoiceUpload, confirm: clientInvoicesApi.confirmFinalInvoice, remove: clientInvoicesApi.removeFinalInvoice }
      : { request: plansApi.requestInvoiceAttachmentUpload, confirm: plansApi.confirmInvoiceAttachment, remove: plansApi.removeInvoiceAttachment };
  return (
    <AttachmentField
      attachment={plan.invoiceAttachment}
      readOnly={!editable}
      attachLabel="Attach client invoice PDF"
      what="client invoice PDF"
      kind="pdf"
      compact={compact}
      onUpload={async (file) => {
        const publicId = await uploadSigned(await api.request(accessToken!, plan.id), file);
        await api.confirm(accessToken!, plan.id, publicId, file.name);
        await refresh();
      }}
      onRemove={async () => {
        await api.remove(accessToken!, plan.id);
        await refresh();
      }}
    />
  );
}
