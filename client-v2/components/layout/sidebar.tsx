"use client";

import Link from "next/link";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { Illustration } from "@/components/taggify/illustration";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Brand } from "./brand";
import { isActiveItem, visibleNav, type NavItem } from "./nav-config";

/**
 * Reference sidebar: white, 240px, 44px rows, peach active row with orange
 * text, Finance expanded into its sub-pages with an orange dot on the current
 * one, and the "Creators create." promo card at the bottom. Collapses to a
 * 72px icon rail (the « button). Hidden below md, where the top bar's menu
 * opens the same nav in a sheet (MobileNav).
 */
export function Sidebar({ active, collapsed, onToggle }: { active: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={cn(
        "workspace-sidebar sticky top-0 hidden h-screen shrink-0 flex-col gap-4 border-r border-border bg-sidebar pb-4 pt-6 transition-[width] duration-drawer ease-out md:flex",
        collapsed ? "w-rail px-3" : "w-sidebar px-5"
      )}
    >
      <div className={cn("flex items-center pb-2", collapsed ? "flex-col gap-3" : "justify-between pl-1")}>
        <Brand compact={collapsed} />
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="grid h-control-sm w-control-sm place-items-center rounded-md border border-input bg-card text-fg-strong transition-colors hover:bg-muted"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>
      <NavList active={active} collapsed={collapsed} />
      {!collapsed && <PromoCard />}
    </aside>
  );
}

export function NavList({ active, collapsed = false, onNavigate }: { active: string; collapsed?: boolean; onNavigate?: () => void }) {
  const { user } = useAuth();
  const items = visibleNav(user);
  return (
    <TooltipProvider delayDuration={200}>
      <nav aria-label="Main" className="thin-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {items.map((item) => {
          const open = isActiveItem(item, active);
          return (
            <div key={item.key} className="flex flex-col gap-1">
              <NavRow item={item} current={item.key === active} highlighted={open} collapsed={collapsed} onNavigate={onNavigate} />
              {!collapsed && open && item.children && item.children.length > 0 && (
                <div className="flex flex-col gap-1">
                  {item.children.map((child) => (
                    <NavRow key={child.key} item={child} sub current={child.key === active} highlighted={child.key === active} onNavigate={onNavigate} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}

function NavRow({ item, sub, current, highlighted, collapsed, onNavigate }: { item: NavItem; sub?: boolean; current: boolean; highlighted: boolean; collapsed?: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  const cls = cn(
    "workspace-nav-item relative flex items-center rounded-md text-body transition-colors duration-hover ease-out",
    sub ? "h-10 pl-14 text-body" : "h-11 gap-4 px-3",
    collapsed && "justify-center px-0",
    highlighted ? "bg-brand-soft font-semibold text-brand-ink ring-1 ring-inset ring-brand-line" : item.built ? "text-fg-strong hover:bg-muted" : "cursor-default text-fg-strong/45",
    sub && highlighted && "ml-6 pl-8 before:absolute before:left-3.5 before:h-1.5 before:w-1.5 before:rounded-full before:bg-brand"
  );
  const inner = (
    <>
      {Icon && <Icon className={cn("h-5 w-5 shrink-0", highlighted ? "text-brand-ink" : "")} strokeWidth={1.7} aria-hidden />}
      <span className={cn(collapsed && "sr-only")}>{item.label}</span>
    </>
  );
  const row = item.built ? (
    <Link href={item.href} aria-current={current ? "page" : undefined} className={cls} onClick={onNavigate}>
      {inner}
    </Link>
  ) : (
    <span aria-disabled="true" className={cls}>
      {inner}
      {!collapsed && <span className="sr-only">(not in the new app yet)</span>}
    </span>
  );
  if (!collapsed && item.built) return row;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right">{item.built ? item.label : `${item.label} isn't in the new app yet`}</TooltipContent>
    </Tooltip>
  );
}

function PromoCard() {
  return (
    <div className="workspace-promo relative mt-auto shrink-0 overflow-hidden rounded-card border bg-card px-4 pt-4 shadow-2">
      <p className="text-body font-bold">
        Creators create.
        <br />
        We make it scalable.
      </p>
      <Illustration name="sidebar-illustration" className="mx-auto mt-2 h-36 w-full" />
    </div>
  );
}
