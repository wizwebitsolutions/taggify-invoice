import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";

const PROFILE_SELECT = {
  id: true,
  phoneNumber: true,
  name: true,
  role: true,
  email: true,
  secondaryPhone: true,
  addressLine1: true,
  addressLine2: true,
  state: true,
  pincode: true,
  whatsappVerified: true,
  createdAt: true,
};

export async function getProfile(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
  return user;
}

export async function updateProfile(userId, data) {
  if (data.email) {
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing && existing.id !== userId) {
      throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "This email is already in use");
    }
  }
  return prisma.user.update({ where: { id: userId }, data, select: PROFILE_SELECT });
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
