import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The production frontend is client-v2 (Next.js 14). It has server-rendered
// routes (/campaigns/[id], /plans/[id], /finance/payouts/[vendorId]), so it
// can't be a static folder like v1's client/out. Instead this same Express
// process runs client-v2's built Next app as a request handler: one service,
// one port, no extra DigitalOcean component (3 Nov).
export const CLIENT_V2_DIR = path.resolve(__dirname, "../../client-v2");

const text = (res, status, body) => res.status(status).type("text/plain").send(body);

/**
 * Returns an Express handler for every non-API request.
 * - Outside production (local `npm run dev`), the frontend is client-v2's own
 *   dev server on :3001, so this just points there.
 * - In production it needs `npm run build` in client-v2 (the root build script
 *   does that); without a build it answers 503 instead of crashing the API.
 * `loadNext` is injectable for tests.
 */
export function createFrontendHandler({ dir = CLIENT_V2_DIR, env = process.env, loadNext } = {}) {
  if (env.NODE_ENV !== "production") {
    return (req, res) => text(res, 404, "In local dev the frontend runs separately: npm --prefix client-v2 run dev (http://localhost:3001).");
  }
  // Same folder client-v2/next.config.mjs builds into (NEXT_DIST_DIR, default .next).
  const distDir = env.NEXT_DIST_DIR || ".next";
  if (!fs.existsSync(path.join(dir, distDir, "BUILD_ID"))) {
    console.error(`client-v2 build not found in ${dir}/${distDir}; run \`npm run build\` in client-v2/.`);
    return (req, res) => text(res, 503, "Frontend build not found. Run `npm run build` in client-v2/ first.");
  }
  // `next` lives in client-v2/node_modules, not the server's.
  const next = loadNext ? loadNext() : createRequire(path.join(dir, "package.json"))("next");
  const nextApp = next({ dev: false, dir });
  const ready = nextApp.prepare().then(() => nextApp.getRequestHandler());
  ready.catch((err) => console.error("client-v2 failed to start", err));
  return async (req, res, nextMiddleware) => {
    try {
      const handle = await ready;
      return await handle(req, res);
    } catch (err) {
      return nextMiddleware(err);
    }
  };
}
