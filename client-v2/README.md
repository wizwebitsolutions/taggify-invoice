# client-v2

Rebuild of the Taggify frontend in the "Premium SaaS Design System v1"
(`../figma-design.md`). Standalone Next.js 14 app on **:3001**, same Express API
as `client/` (`NEXT_PUBLIC_API_URL`, default `http://localhost:4000/api`).
`client/` is untouched.

`lib/api-client.ts`, `lib/auth-context.tsx`, `lib/format.ts` are
copies of `client/lib/*` — keep them in sync when the API changes.
(`lib/utils.ts` differs on purpose: its `cn()` knows our custom type scale.)

UI: `components/ui/` = shadcn/ui (CLI 2.10, Tailwind 3) restyled to the approved
canvas; `components/taggify/` = app pieces built on it. Review pages: `/tokens`,
`/kitchen-sink`.

```bash
npm --prefix client-v2 install
npm --prefix client-v2 run dev     # http://localhost:3001
npm --prefix client-v2 run build
```
