import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { getEffectivePermissions, getOwnCapabilities } from "../../lib/permissions.js";

const PROFILE_SELECT = {
  id: true,
  phoneNumber: true,
  name: true,
  role: true,
  email: true,
  emailVerifiedAt: true,
  secondaryPhone: true,
  addressLine1: true,
  addressLine2: true,
  state: true,
  pincode: true,
  whatsappVerified: true,
  createdAt: true,
};

export async function getProfile(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { ...PROFILE_SELECT, permissions: true } });
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
  // Fresh access (24 Sep) — the client refreshes its nav from this, so an
  // admin switching a section off shows up without a re-login.
  const { permissions: _overlay, ...profile } = user;
  return { ...profile, permissions: getEffectivePermissions(user), ownAccess: getOwnCapabilities(user) };
}

export async function updateProfile(userId, data) {
  if (data.email) {
    // Once verified, `email` is the login identifier + where OTPs go (email
    // 2FA, 21 Sep) — a plain profile save must not be able to repoint it at
    // an inbox nobody has proven they own.
    const self = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
    if (self?.emailVerifiedAt && data.email.trim().toLowerCase() !== self.email) {
      throw new ApiError(409, "EMAIL_LOCKED", "Your verified sign-in email can't be changed from the profile");
    }
    data = { ...data, email: data.email.trim().toLowerCase() };
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing && existing.id !== userId) {
      throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "This email is already in use");
    }
  }
  return prisma.user.update({ where: { id: userId }, data, select: PROFILE_SELECT });
}

/** Who each team row is, so the creator sees a name instead of an id (12 Oct). Only what they need to recognise them. */
const TEAM_MEMBER_INCLUDE = { user: { select: { id: true, name: true, email: true } } };

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
    include: TEAM_MEMBER_INCLUDE,
  });
}

export async function listTeamMembers(creatorId) {
  return prisma.teamMembership.findMany({ where: { creatorId }, include: TEAM_MEMBER_INCLUDE, orderBy: { createdAt: "asc" } });
}
