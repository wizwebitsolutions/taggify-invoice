import type { ReactNode } from "react";

/**
 * Small pieces every data table in the app reuses — column headers,
 * loading skeleton, empty state. One definition, imported everywhere,
 * per frontend.md §3.
 */
export function Th({ children }: { children: ReactNode }) {
  return <div className="text-[0.72rem] font-medium tracking-[0.02em] text-text-muted">{children}</div>;
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3.5 p-5">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-md bg-surface-2" />
      ))}
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return <div className="flex h-40 items-center justify-center px-8 text-center text-[0.875rem] text-text-faint">{label}</div>;
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-rose-line bg-rose-soft px-3.5 py-2.5 text-[0.8125rem] font-medium text-rose">
      {message}
    </p>
  );
}
