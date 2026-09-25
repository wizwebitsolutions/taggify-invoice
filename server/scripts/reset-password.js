// One-off: `node scripts/reset-password.js <email>` — sets a fresh
// admin-generated password for an account that's locked out, the same way
// signup() does it (see src/modules/auth/service.js). Prints the plaintext
// once; never persisted or logged anywhere else.
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { generatePassword } from "../src/lib/auth/passwordGenerator.js";

const BCRYPT_ROUNDS = 12; // matches src/modules/auth/service.js

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: node scripts/reset-password.js <email>");
  process.exit(1);
}

const user = await prisma.user.findUnique({ where: { email } });
if (!user) {
  console.error(`No account found for ${email}`);
  await prisma.$disconnect();
  process.exit(1);
}

const plaintextPassword = generatePassword();
const passwordHash = await bcrypt.hash(plaintextPassword, BCRYPT_ROUNDS);

await prisma.$transaction([
  prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
  // Force every other session/device to re-authenticate, same as a normal password change.
  prisma.refreshToken.updateMany({ where: { userId: user.id, revoked: false }, data: { revoked: true } }),
]);

console.log(`Password reset for ${email} (role ${user.role}).`);
console.log(`New password: ${plaintextPassword}`);
console.log("Log in with this once, then change it from Settings.");

await prisma.$disconnect();
