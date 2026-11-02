"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui Chart (ui.shadcn.com/docs/components/chart), adapted to our tokens:
 * a series' colour comes from ChartConfig and is exposed as `--color-<key>`, so
 * marks use `fill="var(--color-paid)"`. Recharts does the drawing; this file only
 * supplies the container, the theme variables and the tooltip.
 */
export type ChartConfig = Record<string, { label?: React.ReactNode; color?: string }>;

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const ctx = React.useContext(ChartContext);
  if (!ctx) throw new Error("useChart must be used inside a <ChartContainer />");
  return ctx;
}

export const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & { config: ChartConfig; children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"] }
>(({ id, className, children, config, style, ...props }, ref) => {
  const uid = React.useId();
  const chartId = `chart-${id ?? uid.replace(/:/g, "")}`;
  const vars = Object.fromEntries(Object.entries(config).filter(([, v]) => v.color).map(([k, v]) => [`--color-${k}`, v.color])) as React.CSSProperties;
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        ref={ref}
        data-chart={chartId}
        className={cn(
          "analytics-chart flex aspect-video justify-center text-label [&_.recharts-cartesian-axis-tick_text]:fill-chart-axis [&_.recharts-cartesian-grid_line]:stroke-chart-grid [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-surface]:outline-none",
          className
        )}
        style={{ ...vars, ...style }}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
});
ChartContainer.displayName = "ChartContainer";

export const ChartTooltip = RechartsPrimitive.Tooltip;

type TooltipItem = { dataKey?: string | number; name?: string | number; value?: number | string; color?: string; payload?: Record<string, unknown> };

/** Tooltip body: the category label, then one line per series with its formatted value. */
export function ChartTooltipContent({
  active,
  payload,
  label,
  formatter,
  labelKey,
  hideLabel,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: React.ReactNode;
  formatter?: (value: number, key: string) => React.ReactNode;
  labelKey?: string;
  hideLabel?: boolean;
}) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;
  const heading = labelKey ? (payload[0]?.payload?.[labelKey] as React.ReactNode) : label;
  return (
    <div className="grid min-w-32 gap-1 rounded-md border bg-popover px-3 py-2 text-small text-popover-foreground shadow-2">
      {!hideLabel && heading != null && <div className="font-semibold">{heading}</div>}
      {payload.map((item) => {
        const key = String(item.dataKey ?? item.name ?? "value");
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: item.color ?? `var(--color-${key})` }} aria-hidden />
            <span className="text-muted-foreground">{config[key]?.label ?? key}</span>
            <span className="num ml-auto font-semibold">{formatter ? formatter(Number(item.value), key) : item.value}</span>
          </div>
        );
      })}
    </div>
  );
}
