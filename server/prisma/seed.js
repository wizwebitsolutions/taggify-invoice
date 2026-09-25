import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { generatePassword } from "../src/lib/auth/passwordGenerator.js";
import { seedSampleData } from "./seedSample.js";

const prisma = new PrismaClient();

// Email is the login (24 Sep). Dev seeds get *.taggify.test addresses; with
// no RESEND_API_KEY outside production the login code prints to the server
// console (lib/mailer.js), so these can still sign in locally.
async function upsertUser({ phoneNumber, email, name, role }) {
  const existing = await prisma.user.findUnique({ where: { phoneNumber } });
  if (existing) {
    // A DB seeded before email became the login (24 Sep) — backfill it.
    if (!existing.email) return { user: await prisma.user.update({ where: { id: existing.id }, data: { email } }), password: null };
    return { user: existing, password: null };
  }

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { phoneNumber, email, name, role, passwordHash } });
  console.log(`Created ${role} ${name} (${email}) — password: ${password}`);
  return { user, password };
}

async function main() {
  // Stored in full E.164 form (+91 + 10 digits) — matches the login form,
  // which always sends the fixed "+91" prefix plus whatever digits the
  // user types (system design.md's auth flow never splits country code
  // from the rest of the number).
  const { user: admin } = await upsertUser({ phoneNumber: "+919000000001", email: "admin@taggify.test", name: "Ops Admin", role: "ADMIN" });
  const { user: finance } = await upsertUser({ phoneNumber: "+919000000002", email: "finance@taggify.test", name: "Finance User", role: "FINANCE" });
  const { user: creator } = await upsertUser({ phoneNumber: "+919000000003", email: "creator@taggify.test", name: "Demo Creator", role: "CREATOR" });
  const { user: teamMember } = await upsertUser({ phoneNumber: "+919000000004", email: "team@taggify.test", name: "Team Member", role: "TEAM_MEMBER" });

  await prisma.teamMembership.upsert({
    where: { userId_creatorId: { userId: teamMember.id, creatorId: creator.id } },
    create: { userId: teamMember.id, creatorId: creator.id, canSeeMoney: false },
    update: {},
  });

  const asset = await prisma.asset.upsert({
    where: { ownerId_platform_handle: { ownerId: creator.id, platform: "instagram", handle: "demo.page" } },
    create: {
      ownerId: creator.id,
      platform: "instagram",
      handle: "demo.page",
      followers: 118000,
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

  const campaigns = await Promise.all(
    [
      { id: "seed-campaign-1", brandName: "Demo Brand", title: "Demo Brand × Launch Campaign" },
      { id: "seed-campaign-2", brandName: "Northfield Running Co.", title: "Northfield Running Co. × Derby Series" },
      { id: "seed-campaign-3", brandName: "Solmate Coffee", title: "Solmate Coffee × Launch Week" },
    ].map((c) => prisma.campaign.upsert({ where: { id: c.id }, create: c, update: {} }))
  );
  const [campaign1, campaign2, campaign3] = campaigns;

  // Links spanning every stage of the status machine, so the Dashboard
  // table and KPI tiles have something real to show.
  const linkSeeds = [
    { id: "seed-link-1", campaignId: campaign1.id, url: "https://instagram.com/p/abc123", format: "reel", cost: 12500, status: "INSIGHTS_APPROVED" },
    { id: "seed-link-2", campaignId: campaign2.id, url: "https://instagram.com/p/xk291", format: "story", cost: 10000, status: "SCREENSHOT_APPROVED" },
    { id: "seed-link-3", campaignId: campaign3.id, url: "https://instagram.com/p/qm771", format: "carousel", cost: 12500, status: "INVOICED" },
    { id: "seed-link-4", campaignId: campaign1.id, url: "https://instagram.com/p/vv430", format: "reel", cost: 12500, status: "SCREENSHOT_REJECTED" },
    { id: "seed-link-5", campaignId: campaign2.id, url: "https://instagram.com/p/rr812", format: "collaboration", cost: 14000, status: "SUBMITTED" },
    { id: "seed-link-6", campaignId: campaign3.id, url: "https://instagram.com/p/pending1", format: "story", cost: 10000, status: "PENDING_SCREENSHOT_REVIEW" },
  ];

  for (const l of linkSeeds) {
    const link = await prisma.link.upsert({
      where: { id: l.id },
      create: {
        id: l.id,
        campaignId: l.campaignId,
        assetId: asset.id,
        submittedById: creator.id,
        url: l.url,
        format: l.format,
        cost: l.cost,
        status: l.status,
      },
      update: { status: l.status },
    });

    const existingEvents = await prisma.linkStatusEvent.count({ where: { linkId: link.id } });
    if (existingEvents === 0) {
      await prisma.linkStatusEvent.create({
        data: { linkId: link.id, status: "SUBMITTED", actedById: creator.id },
      });
      if (l.status !== "SUBMITTED") {
        await prisma.linkStatusEvent.create({ data: { linkId: link.id, status: l.status, actedById: admin.id } });
      }
    }

    if (["PENDING_SCREENSHOT_REVIEW", "SCREENSHOT_APPROVED", "INSIGHTS_APPROVED", "INVOICED", "SCREENSHOT_REJECTED"].includes(l.status)) {
      await prisma.screenshot.upsert({
        where: { linkId: link.id },
        create: {
          linkId: link.id,
          publicId: `screenshots/${link.id}/seed`,
          approved: l.status === "SCREENSHOT_REJECTED" ? false : true,
          reviewedById: admin.id,
        },
        update: {},
      });
    }

    if (["INSIGHTS_APPROVED", "INVOICED"].includes(l.status)) {
      const existingSnapshot = await prisma.postSnapshot.findFirst({ where: { linkId: link.id } });
      if (!existingSnapshot) {
        await prisma.postSnapshot.create({
          data: {
            linkId: link.id,
            likeCount: 18000,
            commentsCount: 97,
            videoViews: 977600,
            videoPlayCount: 977600,
            saves: 120,
            shares: 45,
            reposts: 12,
          },
        });
      }
    }
  }

  // One invoice covering the already-INVOICED link.
  const invoicedLink = await prisma.link.findUnique({ where: { id: "seed-link-3" }, include: { invoiceItem: true } });
  if (invoicedLink && !invoicedLink.invoiceItem) {
    await prisma.invoice.create({
      data: {
        creatorId: creator.id,
        invoiceNumber: `INV-SEED-${Date.now().toString().slice(-6)}`,
        amount: invoicedLink.cost,
        status: "RAISED",
        gstStatus: "SCHEDULED",
        dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        items: { create: [{ linkId: invoicedLink.id, amount: invoicedLink.cost }] },
      },
    });
  }

  // Job run history for the admin Job Runs screen.
  const jobRunCount = await prisma.jobRun.count();
  if (jobRunCount === 0) {
    await prisma.jobRun.createMany({
      data: [
        { jobName: "instagram_rescrape", status: "success", startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000), finishedAt: new Date(Date.now() - 3 * 60 * 60 * 1000 + 45000) },
        { jobName: "invoice_aging_sweep", status: "success", startedAt: new Date(Date.now() - 20 * 60 * 60 * 1000), finishedAt: new Date(Date.now() - 20 * 60 * 60 * 1000 + 5000) },
        { jobName: "instagram_rescrape", status: "failed", startedAt: new Date(Date.now() - 9 * 60 * 60 * 1000), finishedAt: new Date(Date.now() - 9 * 60 * 60 * 1000 + 12000), error: "APIFY_TOKEN is not set" },
      ],
    });
  }

  // Sample data is for local/testing databases only — never on a production seed unless explicitly asked for.
  if (process.env.NODE_ENV !== "production" || process.env.SEED_SAMPLE_DATA === "true") {
    await seedSampleData(prisma, { admin });
  }

  console.log("Seed complete.", {
    users: { admin: admin.phoneNumber, finance: finance.phoneNumber, creator: creator.phoneNumber, teamMember: teamMember.phoneNumber },
    assetId: asset.id,
    campaignIds: campaigns.map((c) => c.id),
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
