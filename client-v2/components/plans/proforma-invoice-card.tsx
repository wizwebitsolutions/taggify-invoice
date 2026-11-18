"use client";

import { Check, Download, FileText, Lock, Pencil } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-context";
import { plans as plansApi, type Plan } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/taggify/money";
import { StatusPill } from "@/components/taggify/status-pill";

type Step = { title: string; hint: string; state: "done" | "current" | "todo" };

/**
 * Proforma invoice (16 Nov — "make it visible properly in the plan section"):
 * its own card at the top of the plan's right-hand rail, instead of a line at
 * the bottom of the Client card. It shows where the invoice stands as three
 * steps (plan approved → client billing details → PDF), what the form asks
 * for, and the one action that comes next. The form itself is
 * ClientInvoiceDialog; the server only allows it on an approved plan
 * (plans/service.js generateClientInvoice), for people with plans.edit.
 */
export function ProformaInvoiceCard({ plan: p, editable, onOpen }: { plan: Plan; editable: boolean; onOpen: () => void }) {
  const { accessToken } = useAuth();
  const approved = p.status === "APPROVED";
  const number = p.clientInvoiceNumber;
  const download = () => plansApi.downloadClientInvoicePdf(accessToken!, p.id, number!).catch(() => toast.error("Couldn't download the invoice."));

  const steps: Step[] = [
    { title: "Plan approved", hint: approved ? "Done." : "An approver signs off the plan first.", state: approved ? "done" : "current" },
    {
      title: "Client billing details",
      hint: "Company name, GSTIN, billing address, phone (optional), description of service and HSN/SAC.",
      state: number ? "done" : approved ? "current" : "todo",
    },
    { title: "Download the PDF", hint: number ? "Ready to send to the client." : "Numbered automatically from the invoice series.", state: number ? "done" : "todo" },
  ];
  const pill = number ? { tone: "success" as const, label: "Generated" } : approved ? { tone: "warning" as const, label: "Ready to generate" } : { tone: "neutral" as const, label: "Locked" };

  return (
    <Card className={cn("form-panel flex flex-col gap-5 p-6", approved && !number && editable && "border-brand")} data-testid="proforma-invoice-card">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink">
          <FileText className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-card-title">Proforma invoice</h2>
          <p className="text-small text-muted-foreground">The bill the client pays against, made from this plan.</p>
        </div>
        <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
      </div>

      <ol className="flex flex-col" aria-label="Proforma invoice steps">
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex gap-3 pb-4 last:pb-0">
            {i < steps.length - 1 && <span aria-hidden className={cn("absolute left-3.5 top-8 bottom-1 w-px", s.state === "done" ? "bg-success" : "bg-border")} />}
            <span
              aria-hidden
              className={cn(
                "relative grid h-7 w-7 shrink-0 place-items-center rounded-pill text-label font-semibold",
                s.state === "done" && "bg-success-soft text-success-fg",
                s.state === "current" && "bg-brand text-brand-foreground",
                s.state === "todo" && "border border-input text-fg-muted",
              )}
            >
              {s.state === "done" ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn("text-body-strong", s.state === "todo" && "text-muted-foreground")}>
                {s.title}
                <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "current" ? " (next)" : " (later)"}</span>
              </p>
              <p className="text-small text-muted-foreground">{s.hint}</p>
            </div>
          </li>
        ))}
      </ol>

      {number ? (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-label text-muted-foreground">Invoice no.</span>
            <span className="num text-body-strong">{number}</span>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-label text-muted-foreground">Amount</span>
            <span className="text-body-strong">
              <Money value={p.overview.total} />
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="flex-1" onClick={download}>
              <Download />
              Download proforma invoice
            </Button>
            {editable && (
              <Button variant="outline" onClick={onOpen}>
                <Pencil />
                Edit invoice details
              </Button>
            )}
          </div>
        </div>
      ) : approved ? (
        editable ? (
          <Button size="lg" className="w-full" onClick={onOpen}>
            <FileText />
            Generate proforma invoice
          </Button>
        ) : (
          <p className="text-small text-muted-foreground">Not generated yet. Someone who can edit plans generates it.</p>
        )
      ) : (
        <p className="flex items-center gap-2 text-small text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          Unlocks when the plan is approved.
        </p>
      )}
    </Card>
  );
}
