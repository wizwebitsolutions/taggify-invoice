import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown the moment a campaign or plan is clicked, while its page loads
 * (design-fix #2/#7: with no feedback for a few seconds the click looked
 * like it did nothing). Mirrors the detail layout: back link, title, tiles, table.
 */
export function DetailLoading({ active }: { active: string }) {
  return (
    <AppShell active={active}>
      <div className="flex flex-col gap-5 pt-2" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-4 w-32" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-64" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-card" />
          ))}
        </div>
        <Card className="flex flex-col gap-2 p-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </Card>
      </div>
    </AppShell>
  );
}
