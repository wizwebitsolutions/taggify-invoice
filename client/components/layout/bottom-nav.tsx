"use client";

import Link from "next/link";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { GridIcon, CampaignIcon, InvoiceIcon, InventoryIcon, MoreIcon } from "@/components/icons";
import { MoreSheet } from "@/components/layout/more-sheet";
import type { SidebarUser } from "@/components/layout/sidebar";

const TABS = [
  { key: "dashboard", label: "Home", href: "/dashboard", icon: GridIcon },
  { key: "campaigns", label: "Campaigns", href: "/campaigns", icon: CampaignIcon },
  { key: "invoices", label: "Invoices", href: "/invoices", icon: InvoiceIcon },
  // Everyone's Pages registry lives here now (newTask.md, 8 Sep — Assets
  // folded into Inventory), so it keeps Assets' old primary-tab slot.
  { key: "inventory", label: "Inventory", href: "/inventory", icon: InventoryIcon },
] as const;

/**
 * Mobile-only tab bar (`md:hidden` — see AppShell). Five slots max per
 * the nav-hierarchy guideline: the four most-used destinations plus
 * "More", which opens a sheet for everything the desktop sidebar
 * carries beyond those four (Team, Users, Job runs) and everything
 * the desktop topbar carries (notifications, theme, log out).
 */
export function BottomNav({ active, user }: { active: string; user: SidebarUser }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const isMore = active === "profile" || active === "team" || active === "users" || active === "job-runs" || active === "plans" || active === "payments";

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 border-t border-border bg-surface-90 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-1 text-text-faint transition-colors",
                isActive && "text-text before:absolute before:top-0 before:h-[2px] before:w-7 before:rounded-b before:bg-ink before:content-['']"
              )}
            >
              <Icon className="h-[21px] w-[21px]" />
              <span className={cn("text-[10px] leading-none", isActive ? "font-semibold" : "font-medium")}>{tab.label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className={cn("relative flex flex-1 flex-col items-center justify-center gap-1 text-text-faint transition-colors", isMore && "text-text before:absolute before:top-0 before:h-[2px] before:w-7 before:rounded-b before:bg-ink before:content-['']")}
        >
          <MoreIcon className="h-[21px] w-[21px]" />
          <span className={cn("text-[10px] leading-none", isMore ? "font-semibold" : "font-medium")}>More</span>
        </button>
      </nav>

      {moreOpen && <MoreSheet onClose={() => setMoreOpen(false)} user={user} />}
    </>
  );
}
