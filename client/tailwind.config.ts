import type { Config } from "tailwindcss";

/**
 * No literal colors/radii/shadows here — every value below points at a
 * CSS custom property from styles/tokens.css. That file is the single
 * place to change a value; this file just gives it a Tailwind utility
 * name (bg-accent, rounded-lg, ...). See frontend.md §3.
 */
export default {
  darkMode: ["selector", "[data-theme=\"dark\"]"],
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
        "text-2": "var(--text-2)",
        "text-muted": "var(--text-muted)",
        ink: "var(--ink)",
        "ink-fg": "var(--ink-fg)",
        "ink-10": "var(--ink-10)",
        "ink-30": "var(--ink-30)",
        "surface-80": "var(--surface-80)",
        "surface-90": "var(--surface-90)",
        "blue-soft-40": "var(--blue-soft-40)",
        "text-faint": "var(--text-faint)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
        "accent-soft": "var(--accent-soft)",
        "accent-line": "var(--accent-line)",
        "accent-2": "var(--accent-2)",
        "accent-2-soft": "var(--accent-2-soft)",
        "accent-2-line": "var(--accent-2-line)",
        blue: "var(--blue)",
        "blue-soft": "var(--blue-soft)",
        "blue-line": "var(--blue-line)",
        rose: "var(--rose)",
        "rose-soft": "var(--rose-soft)",
        "rose-line": "var(--rose-line)",
        slate: "var(--slate)",
        "slate-soft": "var(--slate-soft)",
        "slate-line": "var(--slate-line)",
      },
      borderRadius: {
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
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
      transitionTimingFunction: {
        premium: "var(--ease)",
      },
      keyframes: {
        "reveal-pop": { from: { opacity: "0", transform: "scale(0.97)" }, to: { opacity: "1", transform: "none" } },
        "grow-x": { from: { transform: "scaleX(0)" }, to: { transform: "scaleX(1)" } },
        "grow-y": { from: { transform: "scaleY(0)" }, to: { transform: "scaleY(1)" } },
        ping: { "0%": { boxShadow: "0 0 0 0 var(--rose-line)" }, "100%": { boxShadow: "0 0 0 8px transparent" } },
      },
      animation: {
        "reveal-pop": "reveal-pop 0.5s var(--ease) both",
        "grow-x": "grow-x 1.1s var(--ease) 0.3s both",
        "grow-y": "grow-y 0.9s var(--ease) 0.4s both",
        ping: "ping 1.8s infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
