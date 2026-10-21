"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { RequireAuth } from "@/components/auth/require-auth";
import { EmailVerifyBanner } from "@/components/auth/email-verify-banner";
import { CreatorTabs } from "./creator-tabs";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

const COLLAPSE_KEY = "taggify_sidebar_collapsed";

/**
 * Reference shell: white sidebar (collapsible to an icon rail) + 70px top bar +
 * the page on the warm canvas. Below md the sidebar is replaced by the top
 * bar's menu sheet. ⌘K / Ctrl+K focuses the top-bar search when it's shown.
 * Wraps the page in <RequireAuth> — that only hides the UI; routes enforce
 * roles server-side.
 */
export function AppShell({ active, children, hideEmailVerifyBanner }: { active: string; children: React.ReactNode; /** /verify-email itself: the banner would link to the page it's on. */ hideEmailVerifyBanner?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();
  const creatorSide = user?.role === "CREATOR" || user?.role === "TEAM_MEMBER";

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // storage blocked: keep the default
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        const box = document.querySelector<HTMLInputElement>("[data-global-search]");
        if (box) {
          e.preventDefault();
          box.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        // per-viewer convenience only
      }
      return !c;
    });
  }

  return (
    <RequireAuth>
      {/* No background here: the canvas gradient (CanvasGlow in the root layout) shows through. */}
      <div className="flex min-h-screen">
        <Sidebar active={active} collapsed={collapsed} onToggle={toggle} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar active={active} />
          <main className={cn("w-full max-w-content flex-1 px-4 pb-10 pt-2 md:px-8", creatorSide && "pb-24 md:pb-10")}>
            <EmailVerifyBanner hidden={hideEmailVerifyBanner} />
            {children}
          </main>
        </div>
        <CreatorTabs active={active} />
      </div>
    </RequireAuth>
  );
}
