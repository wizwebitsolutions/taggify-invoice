"use client";

import { money } from "@/lib/format";
import { useCountUp } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** ₹ amount with Indian grouping (₹12,48,000) and tabular numerals. */
export function Money({
  value,
  signed,
  className,
}: {
  value: number | string;
  /** Show an explicit + / − (GST adds, TDS subtracts). */
  signed?: boolean;
  className?: string;
}) {
  const n = Number(value);
  const text = signed ? `${n < 0 ? "−" : "+"} ${money(Math.abs(n))}` : money(n);
  return <span className={cn("num", className)}>{text}</span>;
}

/** A number (or ₹ amount) that counts up once when it first scrolls into view. */
export function CountUp({ value, asMoney, className }: { value: number; asMoney?: boolean; className?: string }) {
  const { ref, value: shown } = useCountUp<HTMLSpanElement>(value);
  return (
    <span ref={ref} className={cn("num", className)}>
      {asMoney ? money(shown) : shown.toLocaleString("en-IN")}
    </span>
  );
}
