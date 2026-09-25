import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  teamMembership: { findMany: vi.fn() },
  campaign: { findUnique: vi.fn(), findFirst: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: mockPrisma }));

const { creatorCampaignWhere, campaignVisibilityWhere, canCreatorAccessCampaign, ownerIdsFor } = await import("./campaignAccess.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.teamMembership.findMany.mockResolvedValue([]);
});

describe("creator campaign scoping (24 Sep — 'access to their own content, not every')", () => {
  it("a creator's campaigns are the ones one of their pages is booked on — on the root row, a phase, or the parent; a posted link alone doesn't count", () => {
    const onMine = { assignments: { some: { asset: { ownerId: { in: ["c-1"] } } } } };
    expect(creatorCampaignWhere(["c-1"])).toEqual({ OR: [onMine, { phases: { some: onMine } }, { parentCampaign: onMine }] });
  });

  it("a team member works on the pages of the creator(s) they belong to", async () => {
    mockPrisma.teamMembership.findMany.mockResolvedValue([{ creatorId: "c-1" }]);
    expect(await ownerIdsFor({ id: "tm-1", role: "TEAM_MEMBER" })).toEqual(["tm-1", "c-1"]);
    expect(await ownerIdsFor({ id: "c-2", role: "CREATOR" })).toEqual(["c-2"]);
  });

  it("campaignVisibilityWhere: creators and team members are now scoped; staff see everything; planners keep their own-plans scope", async () => {
    expect(JSON.stringify(await campaignVisibilityWhere({ id: "c-1", role: "CREATOR" }))).toContain("c-1");
    expect(JSON.stringify(await campaignVisibilityWhere({ id: "pm-1", role: "PLAN_MAKER" }))).toContain("pm-1");
    expect(await campaignVisibilityWhere({ id: "a-1", role: "ADMIN" })).toEqual({});
    expect(await campaignVisibilityWhere({ id: "f-1", role: "FINANCE" })).toEqual({});
  });

  it("canCreatorAccessCampaign checks the campaign's root group, and is false for a campaign that doesn't exist", async () => {
    mockPrisma.campaign.findUnique.mockResolvedValueOnce({ id: "phase-2", parentCampaignId: "root-1" });
    mockPrisma.campaign.findFirst.mockResolvedValueOnce({ id: "root-1" });
    expect(await canCreatorAccessCampaign({ id: "c-1", role: "CREATOR" }, "phase-2")).toBe(true);
    expect(mockPrisma.campaign.findFirst.mock.calls[0][0].where.id).toBe("root-1");

    mockPrisma.campaign.findUnique.mockResolvedValueOnce({ id: "other", parentCampaignId: null });
    mockPrisma.campaign.findFirst.mockResolvedValueOnce(null);
    expect(await canCreatorAccessCampaign({ id: "c-1", role: "CREATOR" }, "other")).toBe(false);

    mockPrisma.campaign.findUnique.mockResolvedValueOnce(null);
    expect(await canCreatorAccessCampaign({ id: "c-1", role: "CREATOR" }, "missing")).toBe(false);
  });
});
