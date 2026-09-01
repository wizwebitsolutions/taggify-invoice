"use client";

import { useEffect, useState } from "react";

/**
 * The two ambient glow blobs rendered behind every AppShell page (decorative
 * only — see app/globals.css's .glow-blob-a/-b keyframes). Split out as its
 * own client component so the animation can pause via the Page Visibility
 * API while the tab is backgrounded — AppShell itself stays a server
 * component, and the blobs don't keep animating (and compositing) in a tab
 * nobody's looking at. prefers-reduced-motion (handled in globals.css) still
 * wins over this; this only covers the "tab is hidden" case that a media
 * query can't.
 */
export function AmbientGlow() {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    function syncToVisibility() {
      setPaused(document.hidden);
    }
    syncToVisibility();
    document.addEventListener("visibilitychange", syncToVisibility);
    return () => document.removeEventListener("visibilitychange", syncToVisibility);
  }, []);

  const playState = paused ? "paused" : undefined;

  return (
    <>
      <div
        className="glow-blob glow-blob-a -top-24 left-1/3 h-[340px] w-[340px] bg-[radial-gradient(circle,var(--accent)_0%,transparent_72%)] opacity-30"
        style={{ animationPlayState: playState }}
      />
      <div
        className="glow-blob glow-blob-b -bottom-28 right-16 h-[300px] w-[300px] bg-[radial-gradient(circle,var(--accent-2)_0%,transparent_72%)] opacity-20"
        style={{ animationPlayState: playState }}
      />
    </>
  );
}
