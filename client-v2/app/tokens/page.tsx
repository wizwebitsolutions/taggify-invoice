"use client";

import { motion } from "motion/react";
import { Monitor, Moon, Sun } from "lucide-react";

import { money } from "@/lib/format";
import { useCountUp, stagger, staggerItem, pressable } from "@/lib/motion";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

// A1 review surface: every token in BOTH themes side by side, the theme switch,
// and the shared motion presets. Static sample values; no API calls.

const SEMANTIC = [
  ["background", "bg-background"],
  ["card", "bg-card"],
  ["popover / elevated", "bg-popover"],
  ["muted", "bg-muted"],
  ["accent (hover)", "bg-accent"],
  ["primary", "bg-primary"],
  ["destructive", "bg-destructive"],
  ["sidebar", "bg-sidebar"],
] as const;

const TEXT = [
  ["foreground", "text-foreground"],
  ["fg-strong", "text-fg-strong"],
  ["muted-foreground", "text-muted-foreground"],
  ["fg-faint", "text-fg-muted"],
  ["link", "text-link"],
] as const;

const STATUS = [
  ["Approved", "bg-success-soft text-success-fg", "bg-success"],
  ["Pending", "bg-warning-soft text-warning-fg", "bg-warning"],
  ["Rejected", "bg-danger-soft text-danger-fg", "bg-danger"],
  ["Invoiced", "bg-info-soft text-info-fg", "bg-info"],
  ["Draft", "bg-status-neutral-soft text-status-neutral-fg", "bg-status-neutral"],
] as const;

const KPIS = [
  { label: "Campaigns", value: 12, money: false, trend: "↑ 3 vs August", tone: "text-success-fg" },
  { label: "Posts awaiting proof", value: 23, money: false, trend: "↑ 6 since yesterday", tone: "text-warning-fg" },
  { label: "Outstanding to creators", value: 472000, money: true, trend: "₹3,000 is 30+ days overdue", tone: "text-danger-fg" },
];

function ThemePanel({ theme }: { theme: "light" | "dark" }) {
  return (
    <section data-theme={theme} className="flex flex-col gap-6 rounded-modal border border-border bg-background p-6 text-foreground">
      <h2 className="text-h3">{theme === "light" ? "Light" : "Dark"}</h2>

      <div>
        <p className="mb-2 text-label uppercase text-muted-foreground">Surfaces</p>
        <div className="grid grid-cols-4 gap-2">
          {SEMANTIC.map(([name, cls]) => (
            <div key={name} className="flex flex-col gap-1">
              <div className={cn("h-11 rounded-md border border-border", cls)} />
              <span className="text-micro text-muted-foreground">{name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-card border border-border bg-card p-4">
        <p className="mb-2 text-label uppercase text-muted-foreground">Text on card</p>
        <div className="flex flex-col gap-1">
          {TEXT.map(([name, cls]) => (
            <p key={name} className={cn("text-body", cls)}>
              {name} — Upload the insight screenshot for each post.
            </p>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS.map(([label, cls, dot]) => (
          <span key={label} className={cn("inline-flex items-center gap-2 rounded-pill px-3 py-[3px] text-caption", cls)}>
            <span className={cn("h-1.5 w-1.5 rounded-pill", dot)} aria-hidden />
            {label}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className="h-10 rounded-md bg-primary px-4 text-body font-semibold text-primary-foreground transition-colors duration-hover hover:bg-primary-hover">Primary</button>
        <button className="h-10 rounded-md border border-input bg-secondary px-4 text-body font-semibold text-secondary-foreground transition-colors duration-hover hover:bg-accent">Secondary</button>
        <button className="h-10 rounded-md px-4 text-body font-semibold text-muted-foreground transition-colors duration-hover hover:bg-muted hover:text-foreground">Ghost</button>
        <button className="h-10 rounded-md bg-destructive px-4 text-body font-semibold text-destructive-foreground transition-colors duration-hover hover:bg-destructive-hover">Destructive</button>
      </div>

      <input
        aria-label={`${theme} input sample`}
        placeholder="Plan name"
        className="h-control rounded-md border border-input bg-card px-3 text-body text-foreground outline-none transition-[border-color,box-shadow] duration-hover focus:border-ring focus:shadow-focus"
      />

      <div className="flex items-center gap-3 rounded-card bg-sidebar p-3">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-small font-bold text-primary-foreground">T</span>
        <span className="rounded-md bg-sidebar-active px-3 py-2 text-body font-medium text-sidebar-fg-active">Overview</span>
        <span className="px-3 text-body font-medium text-sidebar-fg">Plans</span>
        <span className="ml-auto rounded-pill bg-sidebar-badge px-[7px] text-micro font-semibold text-sidebar">23</span>
      </div>

      <div className="flex h-24 items-end gap-3 border-b border-divider">
        {[40, 62, 52, 74, 86, 100].map((h, i, a) => (
          <div key={i} className={cn("flex-1 rounded-t-sm", i === a.length - 1 ? "bg-chart-primary" : "bg-chart-muted")} style={{ height: `${h}%` }} />
        ))}
      </div>
    </section>
  );
}

function CountUpKpi({ label, value, isMoney, trend, tone }: { label: string; value: number; isMoney: boolean; trend: string; tone: string }) {
  const { ref, value: shown } = useCountUp<HTMLSpanElement>(value);
  return (
    <motion.div variants={staggerItem} className="flex flex-col gap-2 rounded-card border border-border bg-card p-5">
      <span className="text-label uppercase text-muted-foreground">{label}</span>
      <span ref={ref} className="num text-kpi">
        {isMoney ? money(shown) : shown}
      </span>
      <span className={cn("text-small", tone)}>{trend}</span>
    </motion.div>
  );
}

const CHOICES: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

export default function TokensPage() {
  const { choice, resolved, setChoice } = useTheme();

  return (
    <main className="mx-auto flex max-w-[1320px] flex-col gap-10 px-4 py-8 md:px-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-label uppercase text-primary">Taggify · Redesign v1 tokens</p>
          <h1 className="mt-1 text-h1">Foundations</h1>
          <p className="mt-1 text-body text-muted-foreground">
            Light and dark from the approved canvas, mapped to shadcn variable names. Page theme: <span className="font-medium text-foreground">{resolved}</span> ({choice}).
          </p>
        </div>
        <div role="radiogroup" aria-label="Theme" className="inline-flex gap-1 rounded-md bg-muted p-1">
          {CHOICES.map(({ value, label, Icon }) => (
            <button
              key={value}
              role="radio"
              aria-checked={choice === value}
              onClick={() => setChoice(value)}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-sm px-3 text-small font-medium transition-colors duration-hover",
                choice === value ? "bg-card text-foreground shadow-1" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <ThemePanel theme="light" />
        <ThemePanel theme="dark" />
      </div>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-h2">Motion</h2>
          <p className="mt-1 text-body text-muted-foreground">Staggered reveal (40ms apart), count-up on first view, and press feedback. All of it switches off when the OS asks for reduced motion.</p>
        </div>
        <motion.div variants={stagger} initial="hidden" animate="show" className="grid gap-5 md:grid-cols-3">
          {KPIS.map((k) => (
            <CountUpKpi key={k.label} label={k.label} value={k.value} isMoney={k.money} trend={k.trend} tone={k.tone} />
          ))}
        </motion.div>
        <motion.button {...pressable} className="h-12 self-start rounded-md bg-primary px-5 text-body font-semibold text-primary-foreground transition-colors duration-hover hover:bg-primary-hover">
          Press me
        </motion.button>
      </section>
    </main>
  );
}
