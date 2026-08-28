import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { generatePassword } from "../../lib/auth/passwordGenerator.js";
import { ApiError } from "../../middleware/errorHandler.js";

const BCRYPT_ROUNDS = 12;

/**
 * newTask.md #8's "admin will have password of all creators", resolved as
 * reset-and-reveal rather than storing recoverable passwords (see CLAUDE.md
 * / test.md for why): admin can reset any user's password at any moment: a
 * fresh system-generated password is returned once, exactly like account
 * creation — nothing plaintext is ever stored at rest. Existing sessions are
 * revoked, same as a self-service password change, so the old password
 * can't keep working anywhere after this.
 */
export async function resetUserPassword(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found");

  const plaintextPassword = generatePassword();
  const passwordHash = await bcrypt.hash(plaintextPassword, BCRYPT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } }),
  ]);

  return { generatedPassword: plaintextPassword };
}
