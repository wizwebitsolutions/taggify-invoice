import type { Metadata } from "next";
import { inter } from "@/lib/fonts";
import { THEME_BLOCKING_SCRIPT } from "@/lib/theme-context";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taggify",
  description: "Track every post. Get paid on time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Sets data-theme before first paint — avoids a flash of the wrong
            theme. Must run synchronously, ahead of React hydration. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BLOCKING_SCRIPT }} />
      </head>
      <body className="font-ui">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
