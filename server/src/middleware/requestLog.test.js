import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";
import { requestLog, maskUrl, formatRequestLine } from "./requestLog.js";
import { ApiError, errorHandler, notFoundHandler } from "./errorHandler.js";

// Runtime logs (3 Nov — "hard to tell from runtime logs what's the issue or
// what is called"): one line per request with level, status, path, time, user
// and the error's code + message, tied to a request id the client also gets.
const lines = [];
const app = express();
app.use(requestLog({ log: (l) => lines.push(l) }));
app.use((req, _res, next) => {
  if (req.headers["x-test-user"]) req.user = { id: "cmab12xyz-user", role: req.headers["x-test-user"] };
  next();
});
app.get("/api/ok", (_req, res) => res.json({ ok: true }));
app.get("/api/known", (_req, _res, next) => next(new ApiError(502, "FOLLOWERS_FETCH_FAILED", "Couldn't fetch follower counts")));
app.get("/api/guard", (_req, res) => res.status(403).json({ error: { code: "FORBIDDEN", message: "Your access has been restricted" } }));
app.get("/api/boom", () => {
  throw new Error("db exploded");
});
app.get("/_next/static/chunk.js", (_req, res) => res.send("x"));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api", notFoundHandler);
app.use(errorHandler);

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
beforeEach(() => {
  lines.length = 0;
  errSpy.mockClear();
});

// "finish" fires after the response is flushed; give it a tick.
const hit = async (path, headers = {}) => {
  const res = await fetch(`${base}${path}`, { headers });
  await res.text();
  await new Promise((r) => setTimeout(r, 20));
  return res;
};

describe("requestLog", () => {
  it("logs a success as INFO with method, path, time, the user and a request id it also returns", async () => {
    const res = await hit("/api/ok?page=2", { "x-test-user": "ADMIN" });
    expect(lines).toHaveLength(1);
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(lines[0]).toMatch(new RegExp(`^INFO 200 GET /api/ok\\?page=2 \\d+ms ADMIN:cmab12xy req=${id.slice(0, 8)}$`));
  });

  it("a known error is ERROR with its code and message on the line", async () => {
    await hit("/api/known");
    expect(lines[0]).toMatch(/^ERROR 502 GET \/api\/known \d+ms FOLLOWERS_FETCH_FAILED "Couldn't fetch follower counts" req=/);
  });

  it("a guard's direct 403 is WARN with its code, without going through errorHandler", async () => {
    await hit("/api/guard", { "x-test-user": "FINANCE" });
    expect(lines[0]).toMatch(/^WARN 403 GET \/api\/guard \d+ms FINANCE:cmab12xy FORBIDDEN "Your access has been restricted" req=/);
  });

  it("an unexpected 500 logs the real message on the line and the stack under the same request id", async () => {
    const res = await hit("/api/boom");
    const id = res.headers.get("x-request-id").slice(0, 8);
    expect(lines[0]).toMatch(new RegExp(`^ERROR 500 GET /api/boom \\d+ms INTERNAL_ERROR "db exploded" req=${id}$`));
    expect(errSpy).toHaveBeenCalledWith(`[req=${id}] GET /api/boom`, expect.any(Error));
    expect((await (await fetch(`${base}/api/boom`)).json()).error.message).toBe("Something went wrong");
  });

  it("an unknown API route is WARN NOT_FOUND", async () => {
    await hit("/api/nope");
    expect(lines[0]).toMatch(/^WARN 404 GET \/api\/nope \d+ms NOT_FOUND /);
  });

  it("skips Next's static files and the health check", async () => {
    await hit("/_next/static/chunk.js");
    await hit("/health");
    expect(lines).toEqual([]);
  });
});

describe("maskUrl / formatRequestLine", () => {
  it("masks secrets in the query string and keeps the rest", () => {
    expect(maskUrl("/api/integrations/google/callback?code=abc&state=xyz&scope=email")).toBe("/api/integrations/google/callback?code=***&state=***&scope=email");
    expect(maskUrl("/api/integrations/google/connect?token=eyJhbGci")).toBe("/api/integrations/google/connect?token=***");
    expect(maskUrl("/api/plans")).toBe("/api/plans");
  });

  it("flags a slow request", () => {
    expect(formatRequestLine({ method: "GET", url: "/api/assets", status: 200, ms: 3400, requestId: "abcdef12-0000" })).toBe("INFO SLOW 200 GET /api/assets 3400ms req=abcdef12");
  });
});
