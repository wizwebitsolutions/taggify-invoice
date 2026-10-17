import { describe, it, expect, vi } from "vitest";

vi.mock("./prisma.js", () => ({ prisma: {} }));
const { regularSlotIds } = await import("./comboSlots.js");

// Review fix (16 Oct): a combo post may only claim a combo part's slot. With
// no column saying where a slot came from, the plan's regular lines are the
// marker: a row with post number N holds one regular slot per regular line of
// that format with postsPerProfile >= N, at that line's cost.
describe("regularSlotIds — tells a regular line's full-price slot from a combo part's", () => {
  const rows = [{ id: "root", postNumber: 1 }, { id: "p2", postNumber: 2 }];

  it("the slot at the regular line's cost is regular; the split-price one is a combo part", () => {
    const slots = [
      { id: "full", campaignId: "root", cost: 20000, linkId: null },
      { id: "combo", campaignId: "root", cost: "17142.85", linkId: null },
    ];
    expect([...regularSlotIds(slots, rows, [{ cost: 20000, postsPerProfile: 1 }])]).toEqual(["full"]);
  });

  it("only as many per row as the regular lines book there (post 2 has none for a x1 line)", () => {
    const slots = [
      { id: "full", campaignId: "root", cost: 20000, linkId: null },
      { id: "p2-same-price", campaignId: "p2", cost: 20000, linkId: null },
    ];
    expect([...regularSlotIds(slots, rows, [{ cost: 20000, postsPerProfile: 1 }])]).toEqual(["full"]);
  });

  it("a combo share equal to the regular price: one of the two is regular, claimed first", () => {
    const slots = [
      { id: "open", campaignId: "root", cost: 15000, linkId: null },
      { id: "claimed", campaignId: "root", cost: 15000, linkId: "l1" },
    ];
    expect([...regularSlotIds(slots, rows, [{ cost: 15000, postsPerProfile: 1 }])]).toEqual(["claimed"]);
  });

  it("no regular line of the format → every slot is a combo part", () => {
    expect(regularSlotIds([{ id: "x", campaignId: "root", cost: 1 }], rows, []).size).toBe(0);
  });
});
