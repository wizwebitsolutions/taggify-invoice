import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Numbers and money: right-aligned with tabular numerals (§16). */
  align?: "left" | "right";
  /** Card title below md. Defaults to the first column. */
  primary?: boolean;
  className?: string;
}

/**
 * Canvas table on shadcn's Table: inside a card, rows fade up 40ms apart.
 * Below md it becomes stacked cards (§30). `rowActions` appear on row hover
 * or focus on desktop and are always visible on touch.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowActions,
  onRowClick,
  empty = "Nothing here yet.",
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowActions?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;
  empty?: string;
  caption: string;
}) {
  if (rows.length === 0) {
    return <div className="rounded-card border bg-card p-10 text-center text-body text-muted-foreground">{empty}</div>;
  }
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary);
  // Staggered entrance, capped so long tables don't wait.
  const enter = (i: number) => ({ animationDelay: `${Math.min(i, 12) * 40}ms` });
  const enterCls = "animate-in fade-in-0 slide-in-from-bottom-1 duration-page fill-mode-both";

  return (
    <>
      <div className="hidden overflow-hidden rounded-card border bg-card md:block">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={c.align === "right" ? "text-right" : undefined}>
                  {c.header}
                </TableHead>
              ))}
              {rowActions && (
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow
                key={rowKey(row)}
                style={enter(i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(enterCls, onRowClick && "cursor-pointer")}
              >
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn(c.align === "right" && "num text-right", c.className)}>
                    {c.cell(row)}
                  </TableCell>
                ))}
                {rowActions && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1 opacity-0 transition-opacity duration-hover focus-within:opacity-100 group-hover:opacity-100">
                      {rowActions(row)}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden" aria-label={caption}>
        {rows.map((row, i) => (
          <li
            key={rowKey(row)}
            style={enter(i)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn("rounded-card border bg-card p-4", enterCls, onRowClick && "cursor-pointer")}
          >
            <div className="text-body font-medium text-foreground">{primary.cell(row)}</div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
              {rest.map((c) => (
                <div key={c.key} className="min-w-0">
                  <dt className="text-micro uppercase tracking-wide text-muted-foreground">{c.header}</dt>
                  <dd className={cn("mt-1 text-body text-foreground", c.align === "right" && "num")}>{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {rowActions && <div className="mt-3 flex gap-2 border-t border-divider pt-3">{rowActions(row)}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}
