import type { ReactNode } from "react";

const controlClass =
  "h-11 rounded-md border border-border-strong bg-surface-2 px-3.5 text-[0.9375rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** The one labeled-field wrapper and the one select control — every form in the app uses these. See frontend.md §3. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[0.8125rem] font-semibold text-text-muted">{label}</label>
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
