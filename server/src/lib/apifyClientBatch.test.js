import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Import preview's batch profile scrape (14 Sep) against a mocked
 * apify-client: a run that hasn't finished when the wait is up is aborted
 * and treated as an error (never as "these profiles don't exist"), and a
 * batch is split into chunks so one bad chunk only leaves *its* handles
 * unknown.
 */
const call = vi.fn();
const abort = vi.fn(async () => {});
const listItems = vi.fn();
vi.mock("apify-client", () => ({
  ApifyClient: class {
    actor() {
      return { call };
    }
    run() {
      return { abort };
    }
    dataset() {
      return { listItems };
    }
  },
}));

process.env.APIFY_TOKEN = "test-token";
const { ApifyInstagramProvider } = await import("./apifyClient.js");

beforeEach(() => vi.clearAllMocks());

describe("getAccountMetricsBatch", () => {
  it("aborts a run that is still RUNNING after the wait and throws, instead of reporting a half-empty dataset as 'not found'", async () => {
    call.mockResolvedValue({ id: "run-1", status: "RUNNING", defaultDatasetId: "ds-1" });
    listItems.mockResolvedValue({ items: [] });
    await expect(ApifyInstagramProvider.getAccountMetricsBatch(["a.page", "b.page"])).rejects.toThrow(/didn't finish/);
    expect(abort).toHaveBeenCalled();
    expect(listItems).not.toHaveBeenCalled();
  });

  it("splits handles into chunks of 25 and keeps the good chunks when one fails (its handles are simply absent)", async () => {
    const handles = Array.from({ length: 30 }, (_, i) => `page${i}`);
    let runs = 0;
    call.mockImplementation(async (input) => {
      runs += 1;
      if (input.directUrls.length === 25) return { id: "run-ok", status: "SUCCEEDED", defaultDatasetId: "ds-ok" };
      return { id: "run-bad", status: "TIMED-OUT", defaultDatasetId: "ds-bad" };
    });
    listItems.mockResolvedValue({ items: handles.slice(0, 25).map((h) => ({ username: h, followersCount: 10 })) });
    const out = await ApifyInstagramProvider.getAccountMetricsBatch(handles);
    expect(runs).toBe(2);
    expect(Object.keys(out)).toHaveLength(25);
    expect(out.page0).toMatchObject({ followers: 10 });
    expect(out).not.toHaveProperty("page29");
  });

  it("rejects only when every chunk failed", async () => {
    call.mockResolvedValue({ id: "run-bad", status: "ABORTED", defaultDatasetId: "ds" });
    await expect(ApifyInstagramProvider.getAccountMetricsBatch(["a.page"])).rejects.toThrow();
  });
});
