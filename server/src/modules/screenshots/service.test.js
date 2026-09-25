import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { link: { findUnique: vi.fn() }, screenshot: { upsert: vi.fn(), create: vi.fn() }, teamMembership: { findUnique: vi.fn() } };
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

const owner = { id: "c-1", role: "CREATOR" };

beforeEach(() => vi.clearAllMocks());

// 22 Sep — a screenshot uploaded after invoicing used to move the link back
// to a ready-to-invoice status while its InvoiceItem stayed.
describe("requestUploadUrl — INVOICED links can't take a new screenshot", () => {
  it("refuses before minting an upload slot", async () => {
    mockPrisma.link.findUnique.mockResolvedValue({ id: "l1", status: "INVOICED", asset: { ownerId: "c-1" } });
    await expect(requestUploadUrl("l1", owner)).rejects.toMatchObject({ code: "ALREADY_INVOICED", statusCode: 409 });
    expect(mockGetUploadParams).not.toHaveBeenCalled();
  });

  it("confirmUpload refuses too (the invoice may have been raised between the two steps) — before the screenshot row is replaced", async () => {
    mockPrisma.link.findUnique.mockResolvedValue({ id: "l1", status: "INVOICED", asset: { ownerId: "c-1" } });
    await expect(confirmUpload("l1", "screenshots/l1/x.png", owner)).rejects.toMatchObject({ code: "ALREADY_INVOICED" });
    expect(mockPrisma.screenshot.upsert).not.toHaveBeenCalled();
  });

  it("hands out the signed upload for any other status", async () => {
    mockPrisma.link.findUnique.mockResolvedValue({ id: "l1", status: "SUBMITTED", asset: { ownerId: "c-1" } });
    mockGetUploadParams.mockReturnValue({ url: "u", fields: {} });
    await expect(requestUploadUrl("l1", owner)).resolves.toEqual({ url: "u", fields: {} });
    expect(mockGetUploadParams).toHaveBeenCalledWith("screenshots/l1");
  });
});

// 24 Sep — screenshots used to be accepted from any creator/team member for
// any link (role check only). Only the page's own creator, or a team member
// working for them, may upload now.
describe("screenshots — only for your own pages (24 Sep)", () => {
  it("another creator gets 403 NOT_YOUR_PAGE on both steps, and nothing is minted or saved", async () => {
    mockPrisma.link.findUnique.mockResolvedValue({ id: "l1", status: "SUBMITTED", asset: { ownerId: "someone-else" } });
    await expect(requestUploadUrl("l1", owner)).rejects.toMatchObject({ code: "NOT_YOUR_PAGE", statusCode: 403 });
    await expect(confirmUpload("l1", "screenshots/l1/x.png", owner)).rejects.toMatchObject({ code: "NOT_YOUR_PAGE" });
    expect(mockGetUploadParams).not.toHaveBeenCalled();
    expect(mockPrisma.screenshot.upsert).not.toHaveBeenCalled();
  });

  it("a team member working for the page's creator may upload; one who isn't may not", async () => {
    mockPrisma.link.findUnique.mockResolvedValue({ id: "l1", status: "SUBMITTED", asset: { ownerId: "c-1" } });
    mockGetUploadParams.mockReturnValue({ url: "u" });
    const member = { id: "tm-1", role: "TEAM_MEMBER" };

    mockPrisma.teamMembership.findUnique.mockResolvedValueOnce({ id: "m-1" });
    await expect(requestUploadUrl("l1", member)).resolves.toEqual({ url: "u" });
    expect(mockPrisma.teamMembership.findUnique).toHaveBeenCalledWith({ where: { userId_creatorId: { userId: "tm-1", creatorId: "c-1" } } });

    mockPrisma.teamMembership.findUnique.mockResolvedValueOnce(null);
    await expect(requestUploadUrl("l1", member)).rejects.toMatchObject({ code: "NOT_YOUR_PAGE" });
  });
});
