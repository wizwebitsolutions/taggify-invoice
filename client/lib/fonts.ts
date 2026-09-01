import { Inter } from "next/font/google";

/**
 * Single source for the app's font. Swap a face by editing only this
 * file — every consumer reads var(--font-ui) / var(--font-display) from
 * styles/tokens.css, never the font name directly. See frontend.md §3.
 *
 * Was Manrope + Instrument Serif; switched to Inter for the X/Spotify-
 * informed redesign (Aug 2026) — Chirp (X) and Circular (Spotify) are
 * both proprietary and not embeddable, and Inter is the standard open
 * substitute for both (same tall x-height, same small-size hinting).
 * `style: ["normal", "italic"]` is kept because the login hero
 * (app/login/page.tsx) sets `font-display italic`.
 */
export const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-inter",
  display: "swap",
});
