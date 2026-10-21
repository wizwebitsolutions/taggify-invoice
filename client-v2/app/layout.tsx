import type { Metadata } from "next";

import { inter } from "@/lib/fonts";
import { THEME_SCRIPT } from "@/lib/theme";
import { CanvasGlow } from "@/components/layout/canvas-glow";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taggify",
  description: "Track every post. Get paid on time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by THEME_SCRIPT before paint, so React must not warn about it.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <CanvasGlow />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
