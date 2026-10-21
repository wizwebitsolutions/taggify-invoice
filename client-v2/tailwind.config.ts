import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Maps styles/tokens.css (sampled from ux/design-ref/Taggify Vendor Payout - FINAL.png) into utilities. Colours are RGB channels, so every
 * colour supports opacity (`bg-primary/90`).
 *
 * Two naming layers share the same variables:
 * - shadcn/ui names (background, foreground, card, primary, secondary, muted,
 *   accent, destructive, border, input, ring, popover) — what shadcn components use.
 * - Taggify names (surface-*, fg-*, line-*, action-*, status, sidebar) — used by
 *   the app's own components. Same values; pick whichever reads better.
 *
 * Theme is the `data-theme` attribute on <html> (lib/theme.tsx). Prefer tokens;
 * `dark:` exists only as an escape hatch.
 */
const c = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;
const v = (name: string) => `var(--${name})`;
const scale = (prefix: string, steps: (string | number)[]) =>
  Object.fromEntries(steps.map((s) => [s, v(`${prefix}-${s}`)]));

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      screens: { "3xl": "1440px" },
      fontFamily: {
        sans: ["var(--font-inter)", "SF Pro Display", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
      // figma-design.md §02 type scale: [size, { lineHeight, letterSpacing, fontWeight }].
      fontSize: {
        "display-xl": ["48px", { lineHeight: "56px", letterSpacing: "-0.02em", fontWeight: "700" }],
        h1: ["32px", { lineHeight: "40px", letterSpacing: "-0.02em", fontWeight: "700" }],
        h2: ["24px", { lineHeight: "32px", letterSpacing: "-0.02em", fontWeight: "650" }],
        h3: ["20px", { lineHeight: "28px", letterSpacing: "-0.02em", fontWeight: "650" }],
        h4: ["16px", { lineHeight: "24px", letterSpacing: "-0.01em", fontWeight: "650" }],
        "body-lg": ["16px", { lineHeight: "24px" }],
        body: ["14px", { lineHeight: "21px" }],
        small: ["13px", { lineHeight: "18px" }],
        caption: ["12px", { lineHeight: "16px", fontWeight: "500" }],
        micro: ["11px", { lineHeight: "14px", fontWeight: "500" }],
        kpi: ["28px", { lineHeight: "32px", letterSpacing: "-0.02em", fontWeight: "700" }],
        // ── Taggify type scale (ux/design-system.md). Use these; never bracket sizes. ──
        display: ["32px", { lineHeight: "38px", letterSpacing: "-0.03em", fontWeight: "700" }],
        section: ["20px", { lineHeight: "28px", letterSpacing: "-0.02em", fontWeight: "650" }],
        "card-title": ["16px", { lineHeight: "24px", letterSpacing: "-0.01em", fontWeight: "600" }],
        "body-strong": ["14px", { lineHeight: "21px", fontWeight: "600" }],
        th: ["11px", { lineHeight: "16px", letterSpacing: "0.04em", fontWeight: "600" }],
        // The "taggify•" wordmark is a logo, sized as one.
        wordmark: ["28px", { lineHeight: "28px", letterSpacing: "-0.045em", fontWeight: "800" }],
        // Canvas section/KPI label: 12/600 uppercase +0.06em; nav group label: 11/600 +0.08em.
        label: ["12px", { lineHeight: "16px", fontWeight: "500" }],
        "nav-label": ["11px", { lineHeight: "14px", letterSpacing: "0.08em", fontWeight: "600" }],
      },
      fontWeight: { heading: "650" },
      colors: {
        // ── shadcn/ui names ──
        background: c("background"),
        foreground: c("foreground"),
        card: { DEFAULT: c("card"), foreground: c("card-foreground") },
        popover: { DEFAULT: c("popover"), foreground: c("popover-foreground") },
        primary: { DEFAULT: c("primary"), foreground: c("primary-foreground"), hover: c("primary-hover") },
        secondary: { DEFAULT: c("secondary"), foreground: c("secondary-foreground") },
        muted: { DEFAULT: c("muted"), foreground: c("muted-foreground") },
        accent: { DEFAULT: c("accent"), foreground: c("accent-foreground") },
        destructive: { DEFAULT: c("destructive"), foreground: c("destructive-foreground"), hover: c("destructive-hover") },
        border: c("border"),
        input: c("input"),
        ring: { DEFAULT: c("ring"), soft: c("ring-soft") },

        // ── Taggify names (same variables) ──
        brand: {
          ...scale("brand", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
          DEFAULT: c("brand"),
          hover: c("brand-hover"),
          foreground: c("brand-foreground"),
          soft: c("brand-soft"),
          ink: c("brand-ink"),
          line: c("brand-line"),
        },
        peach: c("peach"),
        avatar: { DEFAULT: c("avatar"), foreground: c("avatar-foreground") },
        media: c("media"), // dark tile behind a post thumbnail
        kbd: c("kbd"),
        dropzone: { DEFAULT: c("dropzone"), line: c("dropzone-line") },
        step: { fg: c("step-fg"), line: c("step-line"), ring: c("step-ring"), done: c("step-done"), num: c("step-num") },
        "control-line": c("control-line"),
        chip: { DEFAULT: c("chip"), foreground: c("chip-foreground") },
        tile: {
          coral: c("tile-coral"),
          "coral-icon": c("tile-coral-icon"),
          "coral-fg": c("tile-coral-fg"),
          amber: c("tile-amber"),
          "amber-icon": c("tile-amber-icon"),
          "amber-fg": c("tile-amber-fg"),
          mint: c("tile-mint"),
          "mint-icon": c("tile-mint-icon"),
          "mint-fg": c("tile-mint-fg"),
        },
        neutral: scale("neutral", [0, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        surface: {
          app: c("background"),
          card: c("card"),
          elevated: c("elevated"),
          hover: c("accent"),
          subtle: c("muted"),
          overlay: "rgb(var(--overlay) / 0.4)",
        },
        fg: {
          DEFAULT: c("foreground"),
          strong: c("fg-strong"),
          secondary: c("muted-foreground"),
          muted: c("fg-faint"),
          placeholder: c("placeholder"),
          inverse: c("primary-foreground"),
        },
        line: { DEFAULT: c("border"), strong: c("input"), divider: c("divider") },
        divider: c("divider"),
        link: { DEFAULT: c("link"), hover: c("link-hover") },
        action: {
          DEFAULT: c("primary"),
          hover: c("primary-hover"),
          soft: c("ring-soft"),
          fg: c("primary-foreground"),
          destructive: c("destructive"),
          "destructive-hover": c("destructive-hover"),
        },
        focus: { DEFAULT: c("ring"), ring: c("ring-soft") },
        success: { DEFAULT: c("success"), soft: c("success-soft"), fg: c("success-fg"), strong: c("success-strong"), row: c("success-row") },
        warning: { DEFAULT: c("warning"), soft: c("warning-soft"), fg: c("warning-fg") },
        danger: { DEFAULT: c("danger"), soft: c("danger-soft"), fg: c("danger-fg"), helper: c("danger-helper") },
        info: { DEFAULT: c("info"), soft: c("info-soft"), fg: c("info-fg") },
        "status-neutral": { DEFAULT: c("neutral-dot"), soft: c("neutral-soft"), fg: c("neutral-fg") },
        sidebar: {
          DEFAULT: c("sidebar"),
          fg: c("sidebar-foreground"),
          "fg-active": "rgb(255 255 255 / <alpha-value>)",
          label: c("sidebar-label"),
          badge: c("sidebar-badge"),
          // Canvas: hover rgba(255,255,255,.04), active rgba(255,255,255,.08), divider .08.
          hover: "rgb(255 255 255 / 0.04)",
          active: "rgb(255 255 255 / 0.08)",
          line: "rgb(255 255 255 / 0.08)",
        },
        chart: { primary: c("chart-primary"), muted: c("chart-muted"), grid: c("chart-grid"), axis: c("chart-axis") },
      },
      borderRadius: {
        xs: v("radius-xs"),
        sm: v("radius-sm"),
        md: v("radius-md"),
        lg: v("radius-lg"),
        card: v("radius-card"),
        xl: v("radius-xl"),
        modal: v("radius-modal"),
        "2xl": v("radius-2xl"),
        pill: v("radius-pill"),
      },
      boxShadow: {
        1: v("shadow-1"),
        2: v("shadow-2"),
        3: v("shadow-3"),
        modal: v("shadow-modal"),
        premium: v("shadow-premium"),
        focus: "0 0 0 3px rgb(var(--ring-soft))",
      },
      spacing: {
        sidebar: v("sidebar-width"),
        "sidebar-compact": v("sidebar-width-compact"),
        rail: v("sidebar-rail"),
        topbar: v("topbar-height"),
        "context-rail": v("rail-width"),
        // Control heights (ux/design-system.md): inputs + buttons 40, small 36, large CTA 44.
        control: "40px",
        "control-sm": "36px",
        "control-lg": "44px",
        "auth-hero": v("auth-hero-stage-height"),
        pill: "26px", // status pills ("Verified", "Due")
      },
      maxWidth: { content: v("content-max") },
      // Focus ring and the active-tab underline are 3px (ux/design-system.md).
      ringWidth: { 3: "3px" },
      borderWidth: { 3: "3px" },
      transitionDuration: { hover: "120ms", micro: "160ms", page: "180ms", drawer: "220ms" },
      transitionTimingFunction: { out: v("ease-out") },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in-right": { from: { transform: "translateX(24px)", opacity: "0" }, to: { transform: "translateX(0)", opacity: "1" } },
        "pop-in": { from: { transform: "translateY(8px) scale(0.98)", opacity: "0" }, to: { transform: "translateY(0) scale(1)", opacity: "1" } },
      },
      animation: {
        "fade-in": "fade-in 200ms var(--ease-out)",
        "slide-in-right": "slide-in-right 220ms var(--ease-out)",
        "pop-in": "pop-in 200ms var(--ease-out)",
      },
    },
  },
  plugins: [animate],
};

export default config;
