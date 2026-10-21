"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Light / dark / system theme. The resolved theme is written to
 * `<html data-theme>`; styles/tokens.css swaps every token on it. The choice
 * is a per-viewer convenience, so it lives in localStorage (`taggify_theme`).
 */
export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "taggify_theme";

/**
 * Dark tokens were redone from the approved dark reference on 12 Oct. Set to
 * false to force light for every viewer regardless of saved choice or OS.
 */
export const DARK_MODE_ENABLED = true;

/**
 * Runs in <head> before first paint so the page never flashes the wrong theme.
 * Kept tiny and self-contained (it is inlined as a string).
 */
export const THEME_SCRIPT = DARK_MODE_ENABLED ? `(function(){try{var c=localStorage.getItem("${THEME_STORAGE_KEY}");if(c!=="light"&&c!=="dark")c=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=c}catch(e){document.documentElement.dataset.theme="light"}})();` : `document.documentElement.dataset.theme="light";`;

type ThemeContextValue = {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // null until the stored choice is read on mount, so the apply effect can't
  // briefly override what the head script already set.
  const [choice, setChoiceState] = useState<ThemeChoice | null>(null);
  const [resolved, setResolved] = useState<ResolvedTheme>("light");

  // Pick up what the head script already applied.
  useEffect(() => {
    setChoiceState(readChoice());
    setResolved(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  // Apply the choice; follow the OS while on "system".
  useEffect(() => {
    if (choice === null) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const next = !DARK_MODE_ENABLED ? "light" : choice === "system" ? systemTheme() : choice;
      document.documentElement.dataset.theme = next;
      setResolved(next);
    };
    apply();
    if (choice !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // storage blocked: the theme still applies for this visit
    }
  }, []);

  return <ThemeContext.Provider value={{ choice: choice ?? "system", resolved, setChoice }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
