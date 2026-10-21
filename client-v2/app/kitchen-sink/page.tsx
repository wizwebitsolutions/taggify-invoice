"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, CalendarDays, CircleCheck, CreditCard, ExternalLink, MoreHorizontal, ShieldCheck, Upload, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterSelect } from "@/components/taggify/filter-select";
import { MetricTile } from "@/components/taggify/metric-tile";
import { Money } from "@/components/taggify/money";
import { PlatformIcon } from "@/components/taggify/platform-icon";
import { SearchField } from "@/components/taggify/search-field";
import { StatusPill } from "@/components/taggify/status-pill";
import { UserAvatar } from "@/components/taggify/user-avatar";
import { VerticalSteps } from "@/components/taggify/vertical-steps";
import { cn } from "@/lib/utils";

/**
 * Section 1 review surface: the tokens and every shadcn primitive / Taggify
 * building block, restyled to ux/design-ref/Taggify Vendor Payout - FINAL.png.
 * Static sample content from that design; no API calls, no login needed.
 */

const SWATCHES: [string, string][] = [
  ["Canvas", "bg-background border"],
  ["Card", "bg-card border"],
  ["Black (CTA)", "bg-primary"],
  ["Orange (brand)", "bg-brand"],
  ["Brand soft", "bg-brand-soft"],
  ["Peach (rail)", "bg-peach"],
  ["Chip", "bg-chip"],
  ["Muted", "bg-muted"],
  ["Border", "bg-input"],
  ["Success", "bg-success-strong"],
  ["Verified tint", "bg-success-soft"],
  ["Pending tint", "bg-warning-soft"],
];

type Row = { id: string; caption: string; format: string; campaign: string; brand: string; page: string; followers: string; platform: string; posted: string; status: "Verified" | "Pending"; amount: number };
const ROWS: Row[] = [
  { id: "1", caption: "Monsoon Cravings", format: "Reel", campaign: "Diwali Food Stories", brand: "Saffron Street", page: "@riya.eats", followers: "482K", platform: "instagram", posted: "03 Oct 2026", status: "Verified", amount: 18000 },
  { id: "2", caption: "Hidden Cafes in Delhi", format: "Reel", campaign: "Urban Bites", brand: "Brew Lane", page: "@riya.eats", followers: "482K", platform: "instagram", posted: "28 Sep 2026", status: "Verified", amount: 12500 },
  { id: "3", caption: "Goa Budget Tips", format: "Reel", campaign: "Travel With Riya", brand: "Northbound Trips", page: "@riyatravels", followers: "310K", platform: "instagram", posted: "12 Oct 2026", status: "Verified", amount: 24000 },
  { id: "4", caption: "What I Eat in a Day", format: "Story", campaign: "Foodie Fridays", brand: "Ladoo Lane", page: "@riya.eats", followers: "482K", platform: "instagram", posted: "10 Oct 2026", status: "Pending", amount: 15000 },
];

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-h3 font-bold">{title}</h2>
        {note && <p className="text-small text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export default function KitchenSink() {
  const [selected, setSelected] = useState<Set<string>>(new Set(["1", "3"]));
  const [month, setMonth] = useState("2026-10");
  const [page, setPage] = useState("all");
  const [status, setStatus] = useState("all");
  const [step, setStep] = useState(0);
  const allState = selected.size === ROWS.length ? true : selected.size ? "indeterminate" : false;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-12 px-4 py-10 md:px-8">
      <header className="flex flex-col gap-1">
        <p className="text-small font-medium text-muted-foreground">Section 1 · Foundation</p>
        <h1 className="text-display">Tokens and components</h1>
        <p className="max-w-[70ch] text-body text-muted-foreground">
          Every building block, restyled to the approved vendor payout design. Screens are built only from these. Sample content, no live data.
        </p>
      </header>

      <Section title="Colour" note="Sampled from the approved design. Orange marks the current thing; black is the main action.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {SWATCHES.map(([name, cls]) => (
            <div key={name} className="flex flex-col gap-2">
              <span className={cn("h-14 rounded-md", cls)} />
              <span className="text-small text-fg-strong">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type" note="Inter throughout. Sizes match the design.">
        <Card className="flex flex-col gap-3 p-6">
          <p className="text-display">Riya Mehta</p>
          <p className="num text-display">₹90,500</p>
          <p className="num text-section">₹42,000</p>
          <p className="text-h4">Pages (3)</p>
          <p className="text-body font-medium">Total Dues</p>
          <p className="text-body">Creator / Vendor · 3 pages</p>
          <p className="text-small text-muted-foreground">5 posts across 2 pages</p>
          <p className="text-th uppercase text-muted-foreground">Content · Campaign · Page</p>
        </Card>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg">
            <CreditCard />
            Process Payout
          </Button>
          <Button size="icon-lg" variant="outline" aria-label="More actions">
            <MoreHorizontal />
          </Button>
          <Button>
            Continue to Tax Details
            <ArrowRight />
          </Button>
          <Button variant="success">
            <CircleCheck />
            Submit payout
          </Button>
          <Button variant="brand">Brand action</Button>
          <Button variant="outline">View profile</Button>
          <Button variant="ghost">Back</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Pills, chips and avatars">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone="success">Verified</StatusPill>
          <StatusPill tone="warning">Pending</StatusPill>
          <StatusPill tone="danger">Due</StatusPill>
          <StatusPill tone="success">Paid</StatusPill>
          <Badge variant="success">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Billing approved
          </Badge>
          <Badge variant="chip">Food</Badge>
          <Badge variant="chip">Travel</Badge>
          <Badge variant="tag">Lifestyle</Badge>
          <Badge>Sample data</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <UserAvatar name="Riya Mehta" size="xl" />
          <UserAvatar name="riya eats" size="lg" />
          <UserAvatar name="riya travels" size="md" />
          <UserAvatar name="Riya Vlogs" size="sm" />
          <PlatformIcon platform="instagram" always />
          <PlatformIcon platform="youtube" />
          <span className="text-small text-muted-foreground">Initials show until a real profile photo loads.</span>
        </div>
      </Section>

      <Section title="Search and filters">
        <SearchField variant="soft" label="Search everything" placeholder="Search vendor, page, campaign or content..." shortcut="⌘ K" className="max-w-[740px]" />
        <div className="flex flex-wrap items-center gap-2">
          <SearchField label="Search dues" placeholder="Search campaign or page..." className="w-[220px]" />
          <FilterSelect label="Month" icon={CalendarDays} value={month} onValueChange={setMonth} options={[{ value: "all", label: "All months" }, { value: "2026-10", label: "Oct 2026" }, { value: "2026-09", label: "Sep 2026" }]} />
          <FilterSelect label="Page" value={page} onValueChange={setPage} options={[{ value: "all", label: "All" }, { value: "p1", label: "riya.eats" }, { value: "p2", label: "riyatravels" }]} />
          <FilterSelect label="Status" value={status} onValueChange={setStatus} options={[{ value: "all", label: "All" }, { value: "verified", label: "Verified" }, { value: "pending", label: "Pending" }]} />
        </div>
        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ks-utr">UTR / reference no. (optional)</Label>
            <Input id="ks-utr" placeholder="e.g. UTR82374923" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ks-bad">Payment date</Label>
            <Input id="ks-bad" aria-invalid="true" defaultValue="31-02-2026" />
            <span className="text-caption text-danger-helper">Pick a real date on or before today.</span>
          </div>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="dues">
          <TabsList>
            <TabsTrigger value="dues">Dues (5)</TabsTrigger>
            <TabsTrigger value="paid">Paid (1)</TabsTrigger>
            <TabsTrigger value="inv">Invoices (0)</TabsTrigger>
            <TabsTrigger value="camp">Campaigns (7)</TabsTrigger>
            <TabsTrigger value="bill">Billing Details</TabsTrigger>
          </TabsList>
        </Tabs>
      </Section>

      <Section title="Metric tiles" note="The last one shows the loading state: a bar, never a misleading ₹0.">
        <div className="grid gap-4 md:grid-cols-3">
          <MetricTile tone="coral" icon={Wallet} label="Total Dues" value="₹90,500" meta="5 posts across 2 pages" />
          <MetricTile tone="amber" icon={CalendarDays} label="Dues This Month" value="₹78,000" meta="3 verified in Oct 2026" />
          <MetricTile tone="mint" icon={ShieldCheck} label="Paid This Month" value="" loading meta="Loading payouts…" />
        </div>
      </Section>

      <Section title="Page card">
        <div className="grid max-w-[580px] gap-4 sm:grid-cols-2">
          {[
            ["@riya.eats", "482K followers", "Food", "instagram"],
            ["Riya Vlogs", "120K subscribers", "Lifestyle", "youtube"],
          ].map(([h, r, c, p]) => (
            <Card key={h} className="relative flex items-center gap-4 px-4 py-4">
              <UserAvatar name={h} size="lg" />
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-body font-bold">
                  <PlatformIcon platform={p} />
                  {h}
                </p>
                <p className="mb-2 mt-1 text-body text-muted-foreground">{r}</p>
                <Badge variant="tag">{c}</Badge>
              </div>
              <ExternalLink className="absolute right-4 top-3.5 h-4 w-4 text-muted-foreground" aria-label="Open page" />
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Table" note="Tick rows: selected rows get the peach tint; the header box shows a partial selection.">
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Checkbox aria-label="Select all dues" checked={allState} onCheckedChange={(v) => setSelected(v === true ? new Set(ROWS.map((r) => r.id)) : new Set())} />
                </TableHead>
                <TableHead>Content</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Page</TableHead>
                <TableHead>Posted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map((r) => (
                <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox aria-label={`Select ${r.caption}`} checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="grid h-control w-control place-items-center rounded-sm bg-media text-micro font-semibold text-white">{r.format}</span>
                      <PlatformIcon platform={r.platform} />
                      <span>
                        <span className="block font-medium">{r.caption}</span>
                        <span className="block text-small text-fg-muted">{r.format}</span>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="block font-medium">{r.campaign}</span>
                    <span className="block text-small text-fg-muted">{r.brand}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <UserAvatar name={r.page} size="sm" />
                      <PlatformIcon platform={r.platform} size={16} />
                      <span>
                        <span className="block font-medium">{r.page}</span>
                        <span className="block text-small text-fg-muted">{r.followers}</span>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{r.posted}</TableCell>
                  <TableCell>
                    <StatusPill tone={r.status === "Verified" ? "success" : "warning"}>{r.status}</StatusPill>
                  </TableCell>
                  <TableCell className="text-right text-body font-bold">
                    <Money value={r.amount} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Section>

      <Section title="Payout rail parts" note="Step list (click through) inside the peach rail panel.">
        <div className="flex max-w-[330px] flex-col gap-4 rounded-modal bg-peach px-3 pb-3 pt-5">
          <VerticalSteps steps={["Select dues", "Tax details", "Payment details", "Receipt"]} current={step} allDone={step === 4} />
          <Card className="flex flex-col gap-4 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-body font-bold">Selected for payout</p>
                <p className="text-small text-muted-foreground">2 posts · 2 campaigns</p>
              </div>
              <Money value={42000} className="text-section" />
            </div>
            <div className="overflow-hidden rounded-lg border">
              <div className="flex justify-between px-3 py-2 text-small">
                <span>Base amount</span>
                <Money value={42000} />
              </div>
              <div className="flex justify-between px-3 py-2 text-small">
                <span>TDS (1%)</span>
                <span className="num">− ₹420</span>
              </div>
              <div className="flex justify-between bg-success-row px-3 py-3 font-bold text-success-fg">
                <span>Total payable</span>
                <Money value={41580} className="text-card-title font-extrabold" />
              </div>
            </div>
            <Button size="lg" className="w-full" onClick={() => setStep((s) => (s >= 4 ? 0 : s + 1))}>
              {step >= 3 ? (step === 4 ? "Start again" : "Submit payout") : "Continue"}
              <ArrowRight />
            </Button>
          </Card>
        </div>
      </Section>

      <Section title="Overlays and feedback">
        <div className="flex flex-wrap items-center gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Remove this receipt?</DialogTitle>
                <DialogDescription>You&apos;ll need to upload a receipt again before you can mark this payout as paid.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline">Keep receipt</Button>
                <Button variant="destructive">Remove receipt</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="outline" onClick={() => toast.success("Payout submitted: ₹41,580 to Riya Mehta")}>
            Show toast
          </Button>
          <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-dropzone-line bg-dropzone px-6 py-4 text-center hover:border-brand">
            <Upload className="h-6 w-6" aria-hidden />
            <span className="text-small font-semibold">Upload receipt</span>
            <span className="text-caption text-fg-muted">PNG, JPG or PDF · max 5 MB</span>
            <input type="file" className="sr-only" accept="image/png,image/jpeg,application/pdf" />
          </label>
          <div className="flex w-56 flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </Section>
    </main>
  );
}
