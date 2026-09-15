import { GeistSans } from "geist/font/sans";
import { Instrument_Serif } from "next/font/google";

/**
 * Single source for the app's fonts. Swap a face by editing only this
 * file — every consumer reads var(--font-ui) / var(--font-display) from
 * styles/tokens.css, never the font name directly.
 *
 * Premium redesign (Sep 2026): Geist for every piece of interface text
 * (via Vercel's `geist` package — it isn't in this Next version's Google
 * Fonts list), and Instrument Serif *italic* as the one display accent,
 * used sparingly on page greetings/hero lines through the `.serif`
 * utility in globals.css. Never body copy.
 */
export const geist = GeistSans; // exposes `--font-geist-sans`

export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});
