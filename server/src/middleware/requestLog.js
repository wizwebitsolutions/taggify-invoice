import { randomUUID } from "node:crypto";

/**
 * One readable line per request (3 Nov — "hard to tell from runtime logs what's
 * the issue or what is called"). Replaces morgan's combined format, whose lines
 * were mostly the platform proxy's IP and the browser's user agent:
 *
 *   ERROR 502 GET /api/assets/import/followers/9da943e0… 3012ms ADMIN:cmab12xy FOLLOWERS_FETCH_FAILED "Couldn't fetch…" req=4f1c2a9e
 *
 * - level: ERROR for 5xx, WARN for 4xx, INFO otherwise; SLOW marks anything over SLOW_MS.
 * - who: the caller's role and id from requireAuth (absent before login).
 * - why: errorHandler puts the error's code and message on res.locals.error.
 * - req=: also sent back as X-Request-Id, and printed beside a 500's stack trace.
 * Secrets in the query string (Google sign-in token / code / state) are masked.
 * Next's static files and the health check aren't logged — they'd drown the rest.
 */
export const SLOW_MS = 2000;
const QUIET = [/^\/_next\//, /^\/health$/, /^\/favicon/, /^\/(icon|apple-icon)\.png/, /^\/illustrations\//];
const SECRET_PARAMS = /^(token|code|state|password|secret|signature|key|access_token|refresh_token)$/i;

export function maskUrl(url) {
  const q = url.indexOf("?");
  if (q === -1) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  for (const k of [...params.keys()]) if (SECRET_PARAMS.test(k)) params.set(k, "***");
  // URLSearchParams escapes the mask; keep it readable.
  return `${url.slice(0, q)}?${params.toString().replace(/%2A%2A%2A/g, "***")}`;
}

export function formatRequestLine({ method, url, status, ms, user, error, requestId }) {
  const level = status >= 500 ? "ERROR" : status >= 400 ? "WARN" : "INFO";
  const parts = [ms > SLOW_MS ? `${level} SLOW` : level, status, method, maskUrl(url), `${Math.round(ms)}ms`];
  if (user) parts.push(`${user.role}:${String(user.id).slice(0, 8)}`);
  if (error?.code) parts.push(error.code);
  if (error?.message) parts.push(JSON.stringify(String(error.message).slice(0, 200)));
  parts.push(`req=${requestId.slice(0, 8)}`);
  return parts.join(" ");
}

export function requestLog({ log = console.log } = {}) {
  return (req, res, next) => {
    const requestId = randomUUID();
    req.id = requestId;
    res.setHeader("X-Request-Id", requestId);
    if (QUIET.some((re) => re.test(req.path))) return next();
    const start = process.hrtime.bigint();
    // Guards (requireAuth / requireAccess / validateBody) answer 4xx directly, not via
    // errorHandler — read their { error: { code, message } } body so the line says why.
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 400 && !res.locals.error && body?.error) res.locals.error = { code: body.error.code, message: body.error.message };
      return json(body);
    };
    res.on("finish", () => {
      log(
        formatRequestLine({
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          ms: Number(process.hrtime.bigint() - start) / 1e6,
          user: req.user,
          error: res.locals.error,
          requestId,
        })
      );
    });
    next();
  };
}
