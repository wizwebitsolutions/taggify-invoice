import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { generatePassword } from "../src/lib/auth/passwordGenerator.js";

const prisma = new PrismaClient();

async function upsertUser({ phoneNumber, name, role }) {
  const existing = await prisma.user.findUnique({ where: { phoneNumber } });
  if (existing) return existing;

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { phoneNumber, name, role, passwordHash } });
  console.log(`Created ${role} ${name} (${phoneNumber}) — password: ${password}`);
  return user;
}

async function main() {
  const admin = await upsertUser({ phoneNumber: "9000000001", name: "Ops Admin", role: "ADMIN" });
  await upsertUser({ phoneNumber: "9000000002", name: "Finance User", role: "FINANCE" });
  const creator = await upsertUser({ phoneNumber: "9000000003", name: "Demo Creator", role: "CREATOR" });

  const asset = await prisma.asset.upsert({
    where: { ownerId_platform_handle: { ownerId: creator.id, platform: "instagram", handle: "demo.page" } },
    create: {
      ownerId: creator.id,
      platform: "instagram",
      handle: "demo.page",
      followers: 100000,
      approvalStatus: "approved",
      rateCards: {
        create: [
          { format: "reel", amount: 12500 },
          { format: "story", amount: 10000 },
          { format: "carousel", amount: 12500 },
          { format: "collaboration", amount: 14000 },
        ],
      },
    },
    update: {},
  });

  const campaign = await prisma.campaign.upsert({
    where: { id: "seed-campaign" },
    create: { id: "seed-campaign", brandName: "Demo Brand", title: "Demo Brand x Launch Campaign" },
    update: {},
  });

  console.log("Seed complete.", { adminId: admin.id, assetId: asset.id, campaignId: campaign.id });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
