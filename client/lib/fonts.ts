import { Manrope, Instrument_Serif } from "next/font/google";

/**
 * Single source for both fonts in the app. Swap a face by editing only
 * this file — every consumer reads var(--font-ui) / var(--font-display)
 * from styles/tokens.css, never the font name directly. See frontend.md §3.
 */
export const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});
