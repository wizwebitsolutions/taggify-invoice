import type { Metadata } from "next";
import { manrope, instrumentSerif } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taggify",
  description: "Track every post. Get paid on time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${instrumentSerif.variable}`}>
      <body className="font-ui">{children}</body>
    </html>
  );
}
