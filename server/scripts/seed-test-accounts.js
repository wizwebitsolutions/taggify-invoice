// One-off: `node scripts/seed-test-accounts.js` — creates the dummy planner /
// creator accounts used for manual role testing (user request, 28 Sep), each
// owning the pages named below so the own-content scoping has something real to
// show. Safe to re-run: every write is an upsert keyed on email (users) or
// owner+platform+handle (pages), so it never duplicates and never touches an
// account or page it didn't create.
//
// These addresses are deliberately on the reserved `.test` TLD — no inbox can
// ever exist for them, which is why they're the accounts listed in
// OTP_BYPASS_EMAILS (see src/lib/auth/otpBypass.js); without that env var set
// they can't log in at all, since login emails a code.
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";

const BCRYPT_ROUNDS = 12; // matches src/modules/auth/service.js
// Never hard-coded: these accounts live in the real database, and a password
// in a committed file is a password anyone with the repo has. Pass it in:
//   TEST_ACCOUNT_PASSWORD=... node scripts/seed-test-accounts.js
const PASSWORD = process.env.TEST_ACCOUNT_PASSWORD;
if (!PASSWORD || PASSWORD.length < 10) {
  console.error("Set TEST_ACCOUNT_PASSWORD (10+ characters) to seed the test accounts.");
  process.exit(1);
}

const ACCOUNTS = [
  { email: "planner1@taggify.test", name: "Test Planner One", role: "PLAN_MAKER", pages: [] },
  { email: "planner2@taggify.test", name: "Test Planner Two", role: "PLAN_MAKER", pages: [] },
  { email: "creator1@taggify.test", name: "Test Creator One", role: "CREATOR", pages: ["newspaper", "_naughtyadults_"] },
  { email: "creator2@taggify.test", name: "Test Creator Two", role: "CREATOR", pages: ["naughtyworld", "ghantaa", "trolls_official"] },
];

const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);

for (const account of ACCOUNTS) {
  const user = await prisma.user.upsert({
    where: { email: account.email },
    // emailVerifiedAt is set up front: these addresses can't receive a code, so
    // without it the app would keep prompting them to verify an unverifiable email.
    create: { email: account.email, name: account.name, role: account.role, passwordHash, emailVerifiedAt: new Date() },
    update: { name: account.name, role: account.role, passwordHash, emailVerifiedAt: new Date() },
  });
  console.log(`${account.role.padEnd(11)} ${account.email}  (${user.id})`);

  for (const handle of account.pages) {
    const asset = await prisma.asset.upsert({
      where: { ownerId_platform_handle: { ownerId: user.id, platform: "instagram", handle } },
      // approved, not pending: a pending page is invisible to most of the app,
      // which would make these accounts useless for walking through a flow.
      create: { ownerId: user.id, platform: "instagram", handle, approvalStatus: "approved" },
      update: { approvalStatus: "approved" },
    });
    console.log(`            page @${asset.handle} (${asset.approvalStatus})`);
  }
}

console.log(`\nPassword for all four: ${PASSWORD}`);
console.log("\nAdd this to server/.env (and to Render's env, to use them there) —");
console.log(`OTP_BYPASS_EMAILS=${ACCOUNTS.map((a) => a.email).join(",")}`);

await prisma.$disconnect();
