import type { Config } from "tailwindcss";

/**
 * No literal colors/radii/shadows here — every value below points at a
 * CSS custom property from styles/tokens.css. That file is the single
 * place to change a value; this file just gives it a Tailwind utility
 * name (bg-accent, rounded-lg, ...). See frontend.md §3.
 */
export default {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        sidebar: "var(--sidebar)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        "surface-hover": "var(--surface-hover)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        text: "var(--text)",
        "text-muted": "var(--text-muted)",
        "text-faint": "var(--text-faint)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
        "accent-soft": "var(--accent-soft)",
        "accent-2": "var(--accent-2)",
        "accent-2-soft": "var(--accent-2-soft)",
        blue: "var(--blue)",
        "blue-soft": "var(--blue-soft)",
        rose: "var(--rose)",
        "rose-soft": "var(--rose-soft)",
        slate: "var(--slate)",
        "slate-soft": "var(--slate-soft)",
      },
      borderRadius: {
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "accent-glow": "var(--shadow-accent-glow)",
        glow: "var(--shadow-glow)",
        "glow-hover": "var(--shadow-glow-hover)",
        "glow-rose": "var(--shadow-glow-rose)",
        "glow-rose-hover": "var(--shadow-glow-rose-hover)",
      },
      backdropBlur: {
        glass: "var(--glass-blur)",
      },
      fontFamily: {
        ui: ["var(--font-ui)"],
        display: ["var(--font-display)"],
      },
    },
  },
  plugins: [],
} satisfies Config;
