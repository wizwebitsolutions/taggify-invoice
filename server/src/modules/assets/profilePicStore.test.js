import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Profile pictures stored in Cloudinary (user request, 22 Sep — "pages
 * profile pic should be stored"). storeProfilePic copies Instagram's
 * picture into Cloudinary and saves the link; fetchProfilePic (what
 * GET /assets/:id/profile-pic serves) prefers that stored copy.
 */
const mockPrisma = { asset: { findUnique: vi.fn(), update: vi.fn(async () => ({})) } };
vi.mock("../../lib/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../scraping/service.js", () => ({ refreshAssetMetrics: vi.fn(), applyProfileMetrics: vi.fn() }));
vi.mock("../../lib/apifyClient.js", () => ({ ApifyInstagramProvider: {} }));
vi.mock("../campaigns/service.js", () => ({ fetchSheetCsv: vi.fn() }));
const uploadProfilePic = vi.fn();
let cloudinaryConfigured = true;
vi.mock("../../lib/cloudinaryClient.js", () => ({ uploadProfilePic: (...a) => uploadProfilePic(...a), isCloudinaryConfigured: () => cloudinaryConfigured }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { storeProfilePic, fetchProfilePic, getProfilePicSource } = await import("./service.js");

const IG = "https://scontent.cdninstagram.com/pic.jpg";
const STORED = "https://res.cloudinary.com/demo/image/upload/profile-pics/a1.jpg";
const image = (bytes = "img") => ({ ok: true, status: 200, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new TextEncoder().encode(bytes).buffer });
const failing = (status) => ({ ok: false, status, headers: { get: () => null } });

beforeEach(() => {
  vi.clearAllMocks();
  cloudinaryConfigured = true;
  uploadProfilePic.mockResolvedValue(STORED);
});

describe("storeProfilePic", () => {
  it("downloads the Instagram picture, uploads it to Cloudinary under the page's id, and saves the stored link", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: IG });
    mockFetch.mockResolvedValue(image("avatar-bytes"));

    await storeProfilePic("store-1");

    expect(mockFetch).toHaveBeenCalledWith(IG, expect.anything());
    expect(uploadProfilePic).toHaveBeenCalledWith("store-1", expect.any(Buffer));
    expect(uploadProfilePic.mock.calls[0][1].toString()).toBe("avatar-bytes");
    expect(mockPrisma.asset.update).toHaveBeenCalledWith({ where: { id: "store-1" }, data: { profilePicStoredUrl: STORED } });
  });

  it("with no Cloudinary account configured, does nothing at all (no download, no error log per scrape)", async () => {
    cloudinaryConfigured = false;
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await storeProfilePic("store-0");
    expect(mockPrisma.asset.findUnique).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("does nothing for a page with no Instagram picture yet", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: null });
    await storeProfilePic("store-2");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(uploadProfilePic).not.toHaveBeenCalled();
  });

  it("never throws — an Instagram or Cloudinary failure leaves the stored link untouched", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: IG });
    mockFetch.mockResolvedValue(image());
    uploadProfilePic.mockRejectedValueOnce(new Error("Cloudinary down"));
    await expect(storeProfilePic("store-3")).resolves.toBeUndefined();
    expect(mockPrisma.asset.update).not.toHaveBeenCalled();

    mockFetch.mockResolvedValue(failing(403));
    await expect(storeProfilePic("store-4")).resolves.toBeUndefined();
    expect(mockPrisma.asset.update).not.toHaveBeenCalled();
  });
});

describe("fetchProfilePic — serves the stored copy first", () => {
  it("serves the Cloudinary copy without touching Instagram", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: IG, profilePicStoredUrl: STORED });
    mockFetch.mockResolvedValue(image("stored-bytes"));

    const result = await fetchProfilePic("serve-1");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(STORED, expect.anything());
    expect(result.buffer.toString()).toBe("stored-bytes");
  });

  it("falls back to Instagram when the stored copy can't be loaded", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: IG, profilePicStoredUrl: STORED });
    mockFetch.mockImplementation(async (url) => (url === STORED ? failing(500) : image("ig-bytes")));

    const result = await fetchProfilePic("serve-2");

    expect(result.buffer.toString()).toBe("ig-bytes");
  });

  it("a page with only a stored copy (Instagram link gone) is still served", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: null, profilePicStoredUrl: STORED });
    mockFetch.mockResolvedValue(image("only-stored"));
    expect((await fetchProfilePic("serve-3")).buffer.toString()).toBe("only-stored");
  });
});

describe("getProfilePicSource — what GET /assets/:id/profile-pic sends (design-fix #5, 7 Oct)", () => {
  it("a stored copy is a redirect to it, with no download", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: IG, profilePicStoredUrl: STORED });
    expect(await getProfilePicSource("src-1")).toEqual({ redirect: STORED });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("no stored copy yet: proxies Instagram's picture", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: IG, profilePicStoredUrl: null });
    mockFetch.mockResolvedValue(image("ig-only"));
    const result = await getProfilePicSource("src-2");
    expect(result.buffer.toString()).toBe("ig-only");
    expect(mockFetch).toHaveBeenCalledWith(IG, expect.anything());
  });

  it("no picture at all is a 404", async () => {
    mockPrisma.asset.findUnique.mockResolvedValue({ profilePicUrl: null, profilePicStoredUrl: null });
    await expect(getProfilePicSource("src-3")).rejects.toMatchObject({ statusCode: 404 });
  });
});
