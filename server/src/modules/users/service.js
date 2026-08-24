import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";

export async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, phoneNumber: true, name: true, role: true, whatsappVerified: true, createdAt: true },
  });
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
  return user;
}

/** A Creator grants a Team Member access to their own pages/links. */
export async function addTeamMember(creatorId, { userId, canSeeMoney }) {
  const member = await prisma.user.findUnique({ where: { id: userId } });
  if (!member || member.role !== "TEAM_MEMBER") {
    throw new ApiError(400, "INVALID_TEAM_MEMBER", "Target user must exist and have role TEAM_MEMBER");
  }
  return prisma.teamMembership.upsert({
    where: { userId_creatorId: { userId, creatorId } },
    create: { userId, creatorId, canSeeMoney },
    update: { canSeeMoney },
  });
}

export async function listTeamMembers(creatorId) {
  return prisma.teamMembership.findMany({ where: { creatorId } });
}
