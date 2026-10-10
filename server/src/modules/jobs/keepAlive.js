// Render's free tier spins a web service down after ~15 min with no inbound
// traffic. Pinging our own *public* URL every 10 min goes out through
// Render's proxy and back in, so it counts as inbound traffic and the
// service never idles out. Deliberately not a runTrackedJob — that would
// write a JobRun row every 10 minutes.
//
// URL: KEEP_ALIVE_URL if set, else RENDER_EXTERNAL_URL (Render sets this
// automatically on every web service). Neither exists locally, so this is a
// no-op in dev and tests. KEEP_ALIVE_DISABLED=true turns it off on Render.

export const KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000;

export function keepAliveUrl(env = process.env) {
  if (env.KEEP_ALIVE_DISABLED === "true") return null;
  const base = env.KEEP_ALIVE_URL || env.RENDER_EXTERNAL_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/health`;
}

export async function pingOnce(url, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) console.warn(`keep-alive: ${url} responded ${res.status}`);
  } catch (err) {
    console.warn(`keep-alive: ping to ${url} failed — ${err.message}`);
  }
}

export function startKeepAlive({ env = process.env, fetchImpl = fetch } = {}) {
  const url = keepAliveUrl(env);
  if (!url) {
    console.log("Keep-alive disabled (no RENDER_EXTERNAL_URL / KEEP_ALIVE_URL)");
    return null;
  }
  const timer = setInterval(() => pingOnce(url, fetchImpl), KEEP_ALIVE_INTERVAL_MS);
  timer.unref();
  console.log(`Keep-alive: pinging ${url} every 10 minutes`);
  return timer;
}
