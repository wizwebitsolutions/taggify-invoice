import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFrontendHandler } from "./frontend.js";

const fakeRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => ((res.statusCode = c), res);
  res.type = () => res;
  res.send = (b) => ((res.body = b), res);
  return res;
};

const dirs = [];
const tmpDir = (withBuild) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-"));
  dirs.push(dir);
  if (withBuild) {
    fs.mkdirSync(path.join(dir, ".next"));
    fs.writeFileSync(path.join(dir, ".next", "BUILD_ID"), "test");
  }
  return dir;
};
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("createFrontendHandler (client-v2 served by the API process)", () => {
  it("outside production points at the separate dev server and never loads Next", () => {
    const loadNext = vi.fn();
    const handler = createFrontendHandler({ dir: tmpDir(true), env: { NODE_ENV: "development" }, loadNext });
    const res = fakeRes();
    handler({}, res);
    expect(loadNext).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("localhost:3001");
  });

  it("in production without a client-v2 build answers 503 instead of crashing", () => {
    const loadNext = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = createFrontendHandler({ dir: tmpDir(false), env: { NODE_ENV: "production" }, loadNext });
    const res = fakeRes();
    handler({}, res);
    expect(loadNext).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain("client-v2");
  });

  it("in production hands every request to the built Next app", async () => {
    const handle = vi.fn(async () => {});
    const nextFactory = vi.fn(() => ({ prepare: async () => {}, getRequestHandler: () => handle }));
    const dir = tmpDir(true);
    const handler = createFrontendHandler({ dir, env: { NODE_ENV: "production" }, loadNext: () => nextFactory });
    const req = { url: "/campaigns/abc" };
    const res = fakeRes();
    await handler(req, res, vi.fn());
    expect(nextFactory).toHaveBeenCalledWith({ dev: false, dir });
    expect(handle).toHaveBeenCalledWith(req, res);
  });

  it("passes a Next start-up failure to Express's error handler", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("prepare failed");
    const nextFactory = () => ({ prepare: async () => Promise.reject(boom), getRequestHandler: () => vi.fn() });
    const handler = createFrontendHandler({ dir: tmpDir(true), env: { NODE_ENV: "production" }, loadNext: () => nextFactory });
    const nextMiddleware = vi.fn();
    await handler({}, fakeRes(), nextMiddleware);
    expect(nextMiddleware).toHaveBeenCalledWith(boom);
  });
});
