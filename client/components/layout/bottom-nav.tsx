"use client";

import Link from "next/link";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { GridIcon, CampaignIcon, InvoiceIcon, AssetIcon, MoreIcon } from "@/components/icons";
import { MoreSheet } from "@/components/layout/more-sheet";
import type { SidebarUser } from "@/components/layout/sidebar";

const TABS = [
  { key: "dashboard", label: "Home", href: "/dashboard", icon: GridIcon },
  { key: "campaigns", label: "Campaigns", href: "/campaigns", icon: CampaignIcon },
  { key: "invoices", label: "Invoices", href: "/invoices", icon: InvoiceIcon },
  { key: "assets", label: "Assets", href: "/assets", icon: AssetIcon },
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
  const isMore = active === "profile" || active === "team" || active === "users" || active === "job-runs" || active === "inventory";

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 border-t border-border bg-sidebar md:hidden"
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
                "flex flex-1 flex-col items-center justify-center gap-1 text-text-faint",
                isActive && "text-accent"
              )}
            >
              <Icon className="h-[21px] w-[21px]" />
              <span className={cn("text-[10px] leading-none", isActive ? "font-bold" : "font-semibold")}>{tab.label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className={cn("flex flex-1 flex-col items-center justify-center gap-1 text-text-faint", isMore && "text-accent")}
        >
          <MoreIcon className="h-[21px] w-[21px]" />
          <span className={cn("text-[10px] leading-none", isMore ? "font-bold" : "font-semibold")}>More</span>
        </button>
      </nav>

      {moreOpen && <MoreSheet onClose={() => setMoreOpen(false)} user={user} />}
    </>
  );
}
