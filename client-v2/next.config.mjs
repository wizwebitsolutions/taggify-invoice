/** @type {import('next').NextConfig} */
// client-v2 — the "Premium SaaS Design System v1" rebuild (figma-design.md).
// Runs alongside client/ on :3001 against the same API; no static export yet.
// NEXT_DIST_DIR lets the e2e run build into its own folder (NEXT_DIST_DIR=.next-e2e next build / next start -p 3101)
// without touching the .next/ the dev server on :3001 is using.
const nextConfig = { distDir: process.env.NEXT_DIST_DIR || ".next" };

export default nextConfig;
