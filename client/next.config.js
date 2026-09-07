/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export — server/ serves client/out directly so one Render
  // service hosts the whole app instead of Vercel + Render. See CLAUDE.md.
  output: "export",
};

export default nextConfig;
