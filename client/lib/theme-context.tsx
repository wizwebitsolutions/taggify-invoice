"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "taggify_theme";
export type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Applies `data-theme` on <html> (styles/tokens.css reads it) and briefly
 * tags <html> with .theme-transition so the swap cross-fades instead of
 * flashing (globals.css scopes the transition to that class only, so
 * normal hover/focus transitions elsewhere stay unaffected).
 */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.add("theme-transition");
  root.dataset.theme = theme;
  window.setTimeout(() => root.classList.remove("theme-transition"), 260);
}

// Mirrors the inline blocking script in app/layout.tsx — kept in sync so a
// remount (e.g. Fast Refresh) resolves to the same theme it already set.
function resolveInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // storage blocked — fall through
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The blocking script in layout.tsx already painted the right theme
  // before hydration — read it back from the DOM rather than guessing
  // again, so this first render can't disagree with what's on screen.
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark"
  );

  useEffect(() => {
    setThemeState(resolveInitialTheme());
  }, []);

  function setTheme(next: Theme) {
    setThemeState(next);
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage blocked — theme still applies for this session
    }
  }

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

/** Inlined into app/layout.tsx's <head> — must stay dependency-free (runs before React/hydration). */
export const THEME_BLOCKING_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
`;
