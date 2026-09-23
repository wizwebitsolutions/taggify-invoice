import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { link: { findUnique: vi.fn() }, screenshot: { upsert: vi.fn(), create: vi.fn() } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
const mockGetUploadParams = vi.fn();
vi.mock("../../lib/cloudinaryClient.js", () => ({
  buildScreenshotKey: (id) => `screenshots/${id}`,
  getUploadParams: (...a) => mockGetUploadParams(...a),
  objectExists: vi.fn(),
  publicUrlFor: (id) => `https://cloudinary/${id}`,
}));
vi.mock("../links/service.js", () => ({ markPendingScreenshotReview: vi.fn() }));

const { requestUploadUrl, confirmUpload } = await import("./service.js");

beforeEach(() => vi.clearAllMocks());

// 22 Sep — a screenshot uploaded after invoicing used to move the link back
// to a ready-to-invoice status while its InvoiceItem stayed.
describe("requestUploadUrl — INVOICED links can't take a new screenshot", () => {
  it("refuses before minting an upload slot", async () => {
    mockPrisma.link.findUnique.mockResolvedValue({ id: "l1", status: "INVOICED" });
    await expect(requestUploadUrl("l1")).rejects.toMatchObject({ code: "ALREADY_INVOICED", statusCode: 409 });
    expect(mockGetUploadParams).not.toHaveBeenCalled();
  });

  it("confirmUpload refuses too (the invoice may have been raised between the two steps) — before the screenshot row is replaced", async () => {
    mockPrisma.link.findUnique.mockResolvedValue({ id: "l1", status: "INVOICED" });
    await expect(confirmUpload("l1", "screenshots/l1/x.png")).rejects.toMatchObject({ code: "ALREADY_INVOICED" });
    expect(mockPrisma.screenshot.upsert).not.toHaveBeenCalled();
  });

  it("hands out the signed upload for any other status", async () => {
    mockPrisma.link.findUnique.mockResolvedValue({ id: "l1", status: "SUBMITTED" });
    mockGetUploadParams.mockReturnValue({ url: "u", fields: {} });
    await expect(requestUploadUrl("l1")).resolves.toEqual({ url: "u", fields: {} });
    expect(mockGetUploadParams).toHaveBeenCalledWith("screenshots/l1");
  });
});
