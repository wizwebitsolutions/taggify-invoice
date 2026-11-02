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
        "display-xl": [v("text-display-xl"), { lineHeight: v("leading-display-xl"), letterSpacing: v("tracking-display-xl"), fontWeight: v("weight-display-xl") }],
        "h1": [v("text-h1"), { lineHeight: v("leading-h1"), letterSpacing: v("tracking-h1"), fontWeight: v("weight-h1") }],
        "h2": [v("text-h2"), { lineHeight: v("leading-h2"), letterSpacing: v("tracking-h2"), fontWeight: v("weight-h2") }],
        "h3": [v("text-h3"), { lineHeight: v("leading-h3"), letterSpacing: v("tracking-h3"), fontWeight: v("weight-h3") }],
        "h4": [v("text-h4"), { lineHeight: v("leading-h4"), letterSpacing: v("tracking-h4"), fontWeight: v("weight-h4") }],
        "body-lg": [v("text-body-lg"), { lineHeight: v("leading-body-lg") }],
        "body": [v("text-body"), { lineHeight: v("leading-body") }],
        "small": [v("text-small"), { lineHeight: v("leading-small") }],
        "caption": [v("text-caption"), { lineHeight: v("leading-caption"), fontWeight: v("weight-caption") }],
        "micro": [v("text-micro"), { lineHeight: v("leading-micro"), fontWeight: v("weight-micro") }],
        "kpi": [v("text-kpi"), { lineHeight: v("leading-kpi"), letterSpacing: v("tracking-kpi"), fontWeight: v("weight-kpi") }],
        // ── Taggify type scale (ux/design-system.md). Use these; never bracket sizes. ──
        "display": [v("text-display"), { lineHeight: v("leading-display"), letterSpacing: v("tracking-display"), fontWeight: v("weight-display") }],
        "section": [v("text-section"), { lineHeight: v("leading-section"), letterSpacing: v("tracking-section"), fontWeight: v("weight-section") }],
        "card-title": [v("text-card-title"), { lineHeight: v("leading-card-title"), letterSpacing: v("tracking-card-title"), fontWeight: v("weight-card-title") }],
        "body-strong": [v("text-body-strong"), { lineHeight: v("leading-body-strong"), fontWeight: v("weight-body-strong") }],
        "th": [v("text-th"), { lineHeight: v("leading-th"), letterSpacing: v("tracking-th"), fontWeight: v("weight-th") }],
        // The "taggify•" wordmark is a logo, sized as one.
        "wordmark": [v("text-wordmark"), { lineHeight: v("leading-wordmark"), letterSpacing: v("tracking-wordmark"), fontWeight: v("weight-wordmark") }],
        // Canvas section/KPI label: 12/600 uppercase +0.06em; nav group label: 11/600 +0.08em.
        "label": [v("text-label"), { lineHeight: v("leading-label"), fontWeight: v("weight-label") }],
        "nav-label": [v("text-nav-label"), { lineHeight: v("leading-nav-label"), letterSpacing: v("tracking-nav-label"), fontWeight: v("weight-nav-label") }],
      },
      fontWeight: Object.fromEntries(["thin", "extralight", "light", "normal", "medium", "semibold", "heading", "bold", "extrabold", "black"].map((weight) => [weight, v(`weight-${weight}`)])),
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
          "fg-active": c("brand-ink"),
          label: c("sidebar-label"),
          badge: c("sidebar-badge"),
          // Semantic aliases adapt together in light and dark themes.
          hover: c("muted"),
          active: c("brand-soft"),
          line: c("divider"),
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
        focus: "0 0 0 1px rgb(var(--ring-soft))",
      },
      spacing: {
        ...Object.fromEntries([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96].map((step) => [String(step), `calc(var(--space-unit) * ${step})`])),
        sidebar: v("sidebar-width"),
        "sidebar-compact": v("sidebar-width-compact"),
        rail: v("sidebar-rail"),
        topbar: v("topbar-height"),
        "context-rail": v("rail-width"),
        // Control heights (ux/design-system.md): inputs + buttons 40, small 36, large CTA 44.
        control: v("control-height"),
        "control-sm": v("control-height-sm"),
        "control-lg": v("control-height-lg"),
        "auth-hero": v("auth-hero-stage-height"),
        pill: v("pill-height"), // status pills ("Verified", "Due")
      },
      maxWidth: { content: v("content-max") },
      // Focus ring is 1px (user choice, 21 Oct); the active-tab underline stays 3px.
      ringWidth: { 3: v("emphasis-width"), focus: v("focus-width") },
      borderWidth: { 3: v("emphasis-width") },
      transitionDuration: { hover: v("duration-hover"), micro: v("duration-micro"), page: v("duration-page"), drawer: v("duration-drawer") },
      transitionTimingFunction: { out: v("ease-out") },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in-right": { from: { transform: "translateX(var(--enter-slide))", opacity: "0" }, to: { transform: "translateX(0)", opacity: "1" } },
        "pop-in": { from: { transform: "translateY(var(--enter-rise)) scale(0.98)", opacity: "0" }, to: { transform: "translateY(0) scale(1)", opacity: "1" } },
      },
      animation: {
        "fade-in": "fade-in var(--duration-enter) var(--ease-out)",
        "slide-in-right": "slide-in-right var(--duration-drawer) var(--ease-out)",
        "pop-in": "pop-in var(--duration-enter) var(--ease-out)",
      },
    },
  },
  plugins: [animate],
};

export default config;
