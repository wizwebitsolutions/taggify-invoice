"use client";

import { BadgeCheck, Wallet } from "lucide-react";

import type { Plan, SavedClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input, inputClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type Basics = { name: string; clientName: string; clientContact: string; clientCompany: string; clientGstNumber: string; clientAddress: string; notes: string };

export const emptyBasics: Basics = { name: "", clientName: "", clientContact: "", clientCompany: "", clientGstNumber: "", clientAddress: "", notes: "" };

export const basicsFromPlan = (p: Plan): Basics => ({
  name: p.name,
  clientName: p.clientName,
  clientContact: p.clientContact ?? "",
  clientCompany: p.clientCompany ?? "",
  clientGstNumber: p.clientGstNumber ?? "",
  clientAddress: p.clientAddress ?? "",
  notes: p.notes ?? "",
});

export const basicsComplete = (b: Basics) => !!(b.name.trim() && b.clientName.trim() && b.notes.trim());

/** Step 1 · Client & brief. The budget is set on the next step, before any page is picked (as in v1). */
export function BasicsStep({ basics, setBasics, clients, source }: { basics: Basics; setBasics: (fn: (b: Basics) => Basics) => void; clients: SavedClient[]; source?: Plan }) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="p-6">{source ? <VariantBasics source={source} /> : <BasicsForm basics={basics} setBasics={setBasics} clients={clients} />}</Card>
      <aside className="flex flex-col gap-3 rounded-card border bg-brand-50 p-5">
        <span className="grid h-10 w-10 place-items-center rounded-md bg-card text-brand-ink">
          <Wallet className="h-5 w-5" aria-hidden />
        </span>
        <p className="text-body-strong">Budget comes next</p>
        <p className="text-small text-muted-foreground">On the next step you set what we can spend on pages, then pick pages within it. The price quoted to the client is set on the Pricing step.</p>
      </aside>
    </div>
  );
}

function BasicsForm({ basics, setBasics, clients }: { basics: Basics; setBasics: (fn: (b: Basics) => Basics) => void; clients: SavedClient[] }) {
  const set = (k: keyof Basics) => (v: string) => setBasics((b) => ({ ...b, [k]: v }));
  const known = clients.find((c) => c.clientName.trim().toLowerCase() === basics.clientName.trim().toLowerCase() && (c.clientCompany || c.clientGstNumber));
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className="md:col-span-2">
        <h2 className="text-card-title">Who is this for?</h2>
        <p className="text-small text-muted-foreground">The client and the brief print on the plan and its sheets.</p>
      </div>
      <TextField id="pl-name" label="Plan name" value={basics.name} onChange={set("name")} placeholder="e.g. Diwali Food Stories" />
      <div className="flex flex-col gap-2">
        <Label htmlFor="pl-client">Client</Label>
        <Input
          id="pl-client"
          list="pl-clients"
          value={basics.clientName}
          placeholder="Start typing a client"
          onChange={(e) => {
            const v = e.target.value;
            const saved = clients.find((c) => c.clientName === v);
            setBasics((b) => ({ ...b, clientName: v, ...(saved ? { clientCompany: saved.clientCompany ?? "", clientGstNumber: saved.clientGstNumber ?? "", clientAddress: saved.clientAddress ?? "" } : {}) }));
          }}
        />
        <datalist id="pl-clients">
          {[...new Set(clients.map((c) => c.clientName))].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {known && (
          <p className="flex items-center gap-1.5 text-small text-success-fg">
            <BadgeCheck className="h-4 w-4" aria-hidden />
            Saved client: {[known.clientCompany, known.clientGstNumber].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <TextField id="pl-contact" label="Client contact" optional value={basics.clientContact} onChange={set("clientContact")} placeholder="Name, email or phone" />
      <TextField id="pl-company" label="Company" optional value={basics.clientCompany} onChange={set("clientCompany")} />
      <div className="flex flex-col gap-2 md:col-span-2">
        <Label htmlFor="pl-notes">Brief</Label>
        <textarea id="pl-notes" rows={4} className={cn(inputClass, "h-auto py-2")} placeholder="What the client wants, key dates, must-haves" value={basics.notes} onChange={(e) => set("notes")(e.target.value)} />
        <p className="text-small text-muted-foreground">Required. It prints on the plan PDF.</p>
      </div>
    </div>
  );
}

function VariantBasics({ source }: { source: Plan }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-card-title">Client and brief</h2>
        <p className="text-small text-muted-foreground">Carried over from {source.variantLabel}. Every variant pitches to the same client.</p>
      </div>
      <dl className="grid gap-x-6 gap-y-3 rounded-md bg-muted p-4 text-small sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Client</dt>
          <dd className="font-semibold">{source.clientName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Company</dt>
          <dd className="font-semibold">{source.clientCompany || "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Brief</dt>
          <dd>{source.notes || "—"}</dd>
        </div>
      </dl>
    </div>
  );
}

export function TextField({ id, label, value, onChange, optional, type = "text", placeholder, className, inputClassName }: { id: string; label: string; value: string; onChange: (v: string) => void; optional?: boolean; type?: string; placeholder?: string; className?: string; inputClassName?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </Label>
      <Input id={id} type={type} inputMode={type === "number" ? "numeric" : undefined} value={value} placeholder={placeholder} className={inputClassName} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
