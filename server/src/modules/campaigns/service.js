import { prisma } from "../../lib/prisma.js";

export async function listCampaigns({ search } = {}) {
  return prisma.campaign.findMany({
    where: search
      ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { brandName: { contains: search, mode: "insensitive" } }] }
      : undefined,
    orderBy: { createdAt: "desc" },
  });
}

export async function createCampaign({ brandName, title, deadline }) {
  return prisma.campaign.create({ data: { brandName, title, deadline } });
}

export async function updateCampaign(id, data) {
  return prisma.campaign.update({ where: { id }, data });
}
