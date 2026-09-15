import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const controlClass =
  "h-10 rounded-md border border-border-strong bg-surface px-3 text-[0.875rem] text-text shadow-card transition-[box-shadow,border-color] duration-150 placeholder:text-text-faint hover:border-text-faint focus:outline-none focus-visible:border-ink focus-visible:ring-[3px] focus-visible:ring-ink-10";

/** The one labeled-field wrapper and the one select control — every form in the app uses these. See frontend.md §3. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[0.78rem] font-medium text-text-2">{label}</label>
      {children}
    </div>
  );
}

export function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={controlClass}>
      {children}
    </select>
  );
}

export function TextField({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} className={controlClass} {...rest} />;
}

/** Multi-line counterpart to TextField — the plan wizard's Basics step uses
 *  it for the free-form brief/note. */
export function TextArea({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} className={`${controlClass} h-auto min-h-20 resize-y py-2.5`} {...rest} />;
}


/* ── Numeric / phone fields ─────────────────────────────────────────────
 * The app never uses <input type="number"> for money or counts any more
 * (user request, 13 Sep): no spinner arrows, no scroll-wheel changing a
 * value, Indian digit grouping (1,50,000) on money, and phones capped at
 * 10 digits. Every component below stores a plain digit string in state
 * (what the API wants) and only formats what the user sees.
 */

/** "150000" -> "1,50,000". Digits only in, en-IN grouping out. */
export function formatIndian(digits: string): string {
  const clean = digits.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!clean) return "";
  return Number(clean).toLocaleString("en-IN");
}

export function digitsOnly(value: string, max?: number): string {
  const d = value.replace(/\D/g, "");
  return max ? d.slice(0, max) : d;
}

const numericBase =
  "h-10 rounded-md border border-border-strong bg-surface text-[0.875rem] tabular-nums text-text shadow-card transition-[box-shadow,border-color] duration-150 placeholder:text-text-faint hover:border-text-faint focus:outline-none focus-visible:border-ink focus-visible:ring-[3px] focus-visible:ring-ink-10 disabled:cursor-not-allowed disabled:opacity-50";

/** Rupee amount. `value` is the raw digit string ("150000"); shows "₹ 1,50,000". */
export function MoneyField({
  value,
  onChange,
  className,
  compact,
  ...rest
}: {
  value: string;
  onChange: (digits: string) => void;
  /** Tighter, borderless-prefix variant for table cells. */
  compact?: boolean;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  return (
    <div className={cn("relative", className)}>
      <span className={cn("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted", compact ? "left-2 text-[0.75rem]" : "text-[0.875rem]")}>₹</span>
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={formatIndian(value)}
        onChange={(e) => onChange(digitsOnly(e.target.value, 12))}
        className={cn(numericBase, "w-full text-right", compact ? "h-8 pl-6 pr-2 text-[0.8125rem]" : "pl-8 pr-3", (rest as { className?: string }).className)}
      />
    </div>
  );
}

/** Whole number with no formatting (posts, followers, counts, percentages). */
export function IntegerField({
  value,
  onChange,
  max,
  className,
  ...rest
}: {
  value: string;
  onChange: (digits: string) => void;
  max?: number;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "max">) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={value}
      onChange={(e) => {
        let d = digitsOnly(e.target.value, 12);
        if (max != null && d && Number(d) > max) d = String(max);
        onChange(d);
      }}
      className={cn(numericBase, "px-3 text-right", className)}
    />
  );
}

/** Indian mobile number: fixed +91 prefix, exactly 10 digits, inline error once touched. */
export function PhoneField({
  value,
  onChange,
  error,
  size = "md",
  className,
  ...rest
}: {
  /** Raw digits, at most 10. */
  value: string;
  onChange: (digits: string) => void;
  /** Override the built-in "10 digits" check message (e.g. a server error). */
  error?: string | null;
  size?: "md" | "sm" | "lg";
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "size">) {
  const [touched, setTouched] = useState(false);
  const invalid = touched && value.length > 0 && value.length !== 10;
  const message = error ?? (invalid ? "Enter a valid 10-digit mobile number." : null);
  const h = size === "lg" ? "h-12" : size === "sm" ? "h-9" : "h-10";
  return (
    <div className={className}>
      <div className={cn("flex items-center overflow-hidden rounded-md border bg-surface shadow-card transition-[box-shadow,border-color] duration-150 focus-within:border-ink focus-within:ring-[3px] focus-within:ring-ink-10", h, message ? "border-rose" : "border-border-strong")}>
        <span className="flex h-full items-center border-r border-border px-3 text-[0.875rem] font-medium text-text-muted">+91</span>
        <input
          {...rest}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={10}
          value={value}
          onChange={(e) => onChange(digitsOnly(e.target.value, 10))}
          onBlur={(e) => {
            setTouched(true);
            rest.onBlur?.(e);
          }}
          aria-invalid={Boolean(message)}
          className="h-full w-full bg-transparent px-3 text-[0.875rem] tabular-nums text-text placeholder:text-text-faint focus:outline-none"
        />
      </div>
      {message && <p className="mt-1 text-[0.75rem] text-rose">{message}</p>}
    </div>
  );
}

/** Format checks for the billing profile — surfaced inline, not just server-side. */
export const VALIDATORS = {
  pan: (v: string) => (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v) ? null : "PAN is 10 characters, e.g. ABCDE1234F."),
  gstin: (v: string) => (!v || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v) ? null : "GSTIN is 15 characters, e.g. 27ABCDE1234F1Z5."),
  ifsc: (v: string) => (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v) ? null : "IFSC is 11 characters, e.g. HDFC0001234."),
  bankAccount: (v: string) => (/^[0-9]{9,18}$/.test(v) ? null : "Account number is 9–18 digits."),
  pincode: (v: string) => (!v || /^[1-9][0-9]{5}$/.test(v) ? null : "PIN code is 6 digits."),
  email: (v: string) => (!v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "Enter a valid email address."),
} as const;

export function FieldError({ message }: { message: string | null | undefined }) {
  return message ? <p className="text-[0.75rem] text-rose">{message}</p> : null;
}
