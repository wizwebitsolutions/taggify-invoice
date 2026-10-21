"use client";

import Link from "next/link";

import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { isActiveItem, visibleNav } from "./nav-config";

const CREATOR_TABS = ["dashboard", "submit", "campaigns", "money", "pages"];
const order = (key: string) => CREATOR_TABS.indexOf(key);
/** A bar of more than five tabs gets too cramped to tap. */
const MAX_TABS = 5;

/**
 * Phone bottom tabs for creators and team members (spec §11: their work is
 * thumb-first). Staff keep the top-bar menu. Shows only tabs this user can see;
 * everything else, Bulk Tracker included when the bar is full, is in the top bar's menu.
 */
export function CreatorTabs({ active }: { active: string }) {
  const { user } = useAuth();
  if (user?.role !== "CREATOR" && user?.role !== "TEAM_MEMBER") return null;
  const visible = visibleNav(user);
  const tabs = visible.filter((i) => CREATOR_TABS.includes(i.key) && i.built).sort((a, b) => order(a.key) - order(b.key));
  // Bulk Tracker (opt-in grant) takes a free slot at the end; on a full bar it stays in the top bar's menu.
  const bulkTrack = visible.find((i) => i.key === "bulk-track" && i.built);
  if (bulkTrack && tabs.length < MAX_TABS) tabs.push(bulkTrack);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="flex">
        {tabs.map((t) => {
          const on = isActiveItem(t, active);
          const Icon = t.icon;
          return (
            <li key={t.key} className="flex-1">
              <Link
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={cn("flex h-16 flex-col items-center justify-center gap-1 text-micro font-medium text-fg-muted", on && "text-brand-ink")}
              >
                {Icon && <Icon className="h-5 w-5" aria-hidden />}
                {t.key === "submit" ? "Submit" : t.key === "pages" ? "Pages" : t.key === "bulk-track" ? "Tracker" : t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
