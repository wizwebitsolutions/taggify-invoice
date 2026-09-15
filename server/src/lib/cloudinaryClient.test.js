import { describe, it, expect, vi } from "vitest";

const mockResource = vi.fn();
vi.mock("cloudinary", () => ({
  v2: { config: vi.fn(), api: { resource: (...args) => mockResource(...args) }, utils: { api_sign_request: vi.fn(() => "sig") }, url: vi.fn() },
}));

const { objectExists, buildPlanInvoiceAttachmentKey, buildInvoiceAttachmentKey } = await import("./cloudinaryClient.js");

describe("objectExists — confirms an upload really landed before trusting the client's key", () => {
  it("true when the Admin API returns the resource", async () => {
    mockResource.mockResolvedValueOnce({ public_id: "x" });
    await expect(objectExists("x")).resolves.toBe(true);
  });

  it("false on the SDK's real 404 shape — `{ error: { http_code: 404 } }`, nested (14 Sep: was surfacing as a 500)", async () => {
    mockResource.mockRejectedValueOnce({ error: { message: "Resource not found - x", http_code: 404 } });
    await expect(objectExists("x")).resolves.toBe(false);
  });

  it("false on a bare `http_code: 404` too", async () => {
    mockResource.mockRejectedValueOnce({ http_code: 404 });
    await expect(objectExists("x")).resolves.toBe(false);
  });

  it("rethrows anything that isn't a 404 (auth failure, outage) so it isn't mistaken for a missing upload", async () => {
    mockResource.mockRejectedValueOnce({ error: { message: "Invalid credentials", http_code: 401 } });
    await expect(objectExists("x")).rejects.toMatchObject({ error: { http_code: 401 } });
  });
});

describe("attachment keys keep each record type in its own folder so a confirm can't cross them", () => {
  it("plan and invoice keys differ in prefix and are scoped to the record id", () => {
    expect(buildPlanInvoiceAttachmentKey("plan-1")).toMatch(/^plan-invoice-attachments\/plan-1\/[0-9a-f-]{36}$/);
    expect(buildInvoiceAttachmentKey("inv-1")).toMatch(/^invoice-attachments\/inv-1\/[0-9a-f-]{36}$/);
  });
});
