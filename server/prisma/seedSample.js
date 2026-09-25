/**
 * Sample data for testing the redesigned Plans, Campaigns and Invoices
 * screens with realistic volume: several creators owning categorised
 * pages, campaigns with budget caps / phases / links in every status,
 * plans in every approval state, and GST + non-GST invoices spanning
 * raised / overdue / paid. Idempotent — every row is keyed on a stable
 * `sample-*` id or a unique natural key, so `npm run db:seed` can be
 * re-run safely. Called from seed.js after the base demo accounts exist.
 */
import bcrypt from "bcryptjs";
import { generatePassword } from "../src/lib/auth/passwordGenerator.js";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const daysAhead = (n) => new Date(Date.now() + n * DAY);

const CREATORS = [
  { id: "sample-user-karan", phoneNumber: "+919100000001", name: "Karan Tiwari", pages: [
    { handle: "meme.mafia", category: "Meme page", followers: 2400000, reel: 12000, story: 4000, likes: 48200, views: 1100000 },
    { handle: "laugh.lab", category: "Meme page", followers: 390000, reel: 8000, story: 3000, likes: 19100, views: 310000 },
  ] },
  { id: "sample-user-amit", phoneNumber: "+919100000002", name: "Amit Kumar", pages: [
    { handle: "news.now", category: "News page", followers: 1800000, reel: 22000, story: 8000, likes: 31000, views: 640000 },
  ] },
  { id: "sample-user-neha", phoneNumber: "+919100000003", name: "Neha Rao", pages: [
    { handle: "trend.hub", category: "Fashion", followers: 640000, reel: 7500, story: 4500, likes: 12400, views: 210000 },
    { handle: "style.diaries", category: "Fashion", followers: 450000, reel: 6000, story: 2500, likes: 9800, views: 150000 },
  ] },
  { id: "sample-user-riya", phoneNumber: "+919100000004", name: "Riya Sen", pages: [
    { handle: "foodie.gram", category: "Food", followers: 520000, reel: 6000, story: 2500, likes: 15600, views: 240000 },
  ] },
  { id: "sample-user-dev", phoneNumber: "+919100000005", name: "Dev Mehta", pages: [
    { handle: "paisa.talk", category: "Finance", followers: 310000, reel: 5000, story: 2000, likes: 7200, views: 98000 },
  ] },
  { id: "sample-user-sahil", phoneNumber: "+919100000006", name: "Sahil Patel", pages: [
    { handle: "daily.dose", category: "Meme page", followers: 980000, reel: 9000, story: 3000, likes: 22000, views: 410000 },
    { handle: "city.buzz", category: "News page", followers: 410000, reel: 3500, story: 1500, likes: 5100, views: 72000, approvalStatus: "pending" },
  ] },
];

// Email is the login (24 Sep) — sample accounts get <name>@taggify.test.
async function upsertUser(prisma, { id, phoneNumber, name, role }) {
  const email = `${id.replace(/^sample-user-/, "")}@taggify.test`;
  const existing = await prisma.user.findFirst({ where: { OR: [{ id }, { phoneNumber }] } });
  if (existing) return existing.email ? existing : prisma.user.update({ where: { id: existing.id }, data: { email } });
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { id, phoneNumber, email, name, role, passwordHash } });
  console.log(`Created ${role} ${name} (${phoneNumber}) — password: ${password}`);
  return user;
}

export async function seedSampleData(prisma, { admin }) {
  const planner = await upsertUser(prisma, { id: "sample-user-planner", phoneNumber: "+919100000010", name: "Aman Malhotra", role: "PLAN_MAKER" });

  // ---- Creators + categorised pages with rate cards ----
  const assetsByHandle = {};
  const ownerByHandle = {};
  for (const c of CREATORS) {
    const user = await upsertUser(prisma, { id: c.id, phoneNumber: c.phoneNumber, name: c.name, role: "CREATOR" });
    for (const p of c.pages) {
      const asset = await prisma.asset.upsert({
        where: { ownerId_platform_handle: { ownerId: user.id, platform: "instagram", handle: p.handle } },
        create: {
          ownerId: user.id,
          platform: "instagram",
          handle: p.handle,
          fullName: p.handle.replace(".", " ").replace(/\b\w/g, (m) => m.toUpperCase()),
          followers: p.followers,
          category: p.category,
          approvalStatus: p.approvalStatus ?? "approved",
          rateCards: { create: [
            { format: "reel", amount: p.reel },
            { format: "story", amount: p.story },
            { format: "carousel", amount: Math.round(p.reel * 0.7) },
          ] },
        },
        update: { followers: p.followers, category: p.category },
      });
      assetsByHandle[p.handle] = asset;
      ownerByHandle[p.handle] = user;
      const snap = await prisma.accountSnapshot.findFirst({ where: { assetId: asset.id } });
      if (!snap) {
        await prisma.accountSnapshot.create({ data: { assetId: asset.id, followers: p.followers, mediaCount: 240 } });
      }
    }
  }

  // ---- Campaigns: budget caps, deadlines, one with two phases ----
  const campaignSeeds = [
    { id: "sample-camp-zomato", brandName: "Zomato", title: "Zomato Diwali", costCap: 720000, deadline: daysAhead(12) },
    { id: "sample-camp-zomato-p2", brandName: "Zomato", title: "Zomato Diwali", costCap: null, deadline: daysAhead(12), parentCampaignId: "sample-camp-zomato", phaseNumber: 2 },
    { id: "sample-camp-boat", brandName: "Boat", title: "Boat Nirvana", costCap: 300000, deadline: daysAhead(18) },
    { id: "sample-camp-nykaa", brandName: "Nykaa", title: "Nykaa Summer", costCap: 410000, deadline: daysAhead(33) },
    { id: "sample-camp-swiggy", brandName: "Swiggy", title: "Swiggy Instamart", costCap: 250000, deadline: daysAgo(4) },
  ];
  const campaigns = {};
  for (const c of campaignSeeds) {
    campaigns[c.id] = await prisma.campaign.upsert({ where: { id: c.id }, create: c, update: { costCap: c.costCap, deadline: c.deadline } });
  }

  // ---- Links across every status ----
  const linkSeeds = [
    { id: "sample-link-01", campaign: "sample-camp-zomato", handle: "meme.mafia", format: "reel", cost: 12000, status: "INSIGHTS_APPROVED", ago: 8 },
    { id: "sample-link-02", campaign: "sample-camp-zomato", handle: "trend.hub", format: "story", cost: 4500, status: "PENDING_SCREENSHOT_REVIEW", ago: 1 },
    { id: "sample-link-03", campaign: "sample-camp-zomato", handle: "daily.dose", format: "reel", cost: 9000, status: "SCREENSHOT_REJECTED", ago: 2 },
    { id: "sample-link-04", campaign: "sample-camp-zomato", handle: "laugh.lab", format: "reel", cost: 8000, status: "INVOICED", ago: 14 },
    { id: "sample-link-05", campaign: "sample-camp-zomato-p2", handle: "news.now", format: "reel", cost: 22000, status: "INSIGHTS_PENDING", ago: 3 },
    { id: "sample-link-06", campaign: "sample-camp-zomato-p2", handle: "meme.mafia", format: "reel", cost: 12000, status: "SUBMITTED", ago: 0 },
    { id: "sample-link-07", campaign: "sample-camp-boat", handle: "news.now", format: "reel", cost: 22000, status: "INVOICED", ago: 20 },
    { id: "sample-link-08", campaign: "sample-camp-boat", handle: "foodie.gram", format: "reel", cost: 6000, status: "SCREENSHOT_APPROVED", ago: 5 },
    { id: "sample-link-09", campaign: "sample-camp-boat", handle: "paisa.talk", format: "reel", cost: 5000, status: "INVALID", ago: 9 },
    { id: "sample-link-10", campaign: "sample-camp-nykaa", handle: "trend.hub", format: "reel", cost: 7500, status: "INSIGHTS_APPROVED", ago: 6 },
    { id: "sample-link-11", campaign: "sample-camp-nykaa", handle: "style.diaries", format: "carousel", cost: 4200, status: "PENDING_SCREENSHOT_REVIEW", ago: 2 },
    { id: "sample-link-12", campaign: "sample-camp-swiggy", handle: "foodie.gram", format: "reel", cost: 6000, status: "INVOICED", ago: 30 },
    { id: "sample-link-13", campaign: "sample-camp-swiggy", handle: "daily.dose", format: "story", cost: 3000, status: "INVOICED", ago: 28 },
    { id: "sample-link-14", campaign: "sample-camp-swiggy", handle: "meme.mafia", format: "reel", cost: 12000, status: "INVOICED", ago: 26 },
  ];
  const links = {};
  for (const l of linkSeeds) {
    const asset = assetsByHandle[l.handle];
    const owner = ownerByHandle[l.handle];
    const link = await prisma.link.upsert({
      where: { id: l.id },
      create: {
        id: l.id,
        campaignId: l.campaign,
        assetId: asset.id,
        submittedById: owner.id,
        url: `https://instagram.com/reel/${l.id.replace("sample-link-", "S")}x${l.handle.replace(".", "")}`,
        format: l.format,
        cost: l.cost,
        status: l.status,
        postedAt: daysAgo(l.ago),
        createdAt: daysAgo(l.ago),
      },
      update: { status: l.status },
    });
    links[l.id] = link;
    if ((await prisma.linkStatusEvent.count({ where: { linkId: link.id } })) === 0) {
      await prisma.linkStatusEvent.create({ data: { linkId: link.id, status: "SUBMITTED", actedById: owner.id, createdAt: daysAgo(l.ago) } });
      if (l.status !== "SUBMITTED") await prisma.linkStatusEvent.create({ data: { linkId: link.id, status: l.status, actedById: admin.id } });
    }
    if (["PENDING_SCREENSHOT_REVIEW", "SCREENSHOT_APPROVED", "INSIGHTS_PENDING", "INSIGHTS_APPROVED", "INVOICED", "SCREENSHOT_REJECTED"].includes(l.status)) {
      await prisma.screenshot.upsert({
        where: { linkId: link.id },
        create: { linkId: link.id, publicId: `screenshots/${link.id}/sample`, approved: l.status === "SCREENSHOT_REJECTED" ? false : l.status === "PENDING_SCREENSHOT_REVIEW" ? null : true, reviewedById: l.status === "PENDING_SCREENSHOT_REVIEW" ? null : admin.id },
        update: {},
      });
    }
    if (["INSIGHTS_APPROVED", "INVOICED"].includes(l.status) && !(await prisma.postSnapshot.findFirst({ where: { linkId: link.id } }))) {
      const page = CREATORS.flatMap((c) => c.pages).find((p) => p.handle === l.handle);
      await prisma.postSnapshot.create({ data: { linkId: link.id, likeCount: page.likes, commentsCount: Math.round(page.likes / 40), videoViews: page.views, videoPlayCount: page.views, saves: Math.round(page.likes / 100), shares: Math.round(page.likes / 200), reposts: 4, caption: `Diwali ka asli swaad #ad @${l.handle}`, thumbnailUrl: null } });
    }
  }

  // ---- Invoices: GST + non-GST, raised / overdue / paid ----
  const invoiceSeeds = [
    { number: "INV-2026-0871", handle: "laugh.lab", links: ["sample-link-04"], gst: true, status: "RAISED", payment: "PENDING", gstStatus: "PENDING", due: daysAgo(5), campaign: "sample-camp-zomato" },
    { number: "INV-2026-0874", handle: "news.now", links: ["sample-link-07"], gst: true, status: "APPROVED", payment: "PENDING", gstStatus: "SCHEDULED", due: daysAgo(2), campaign: "sample-camp-boat" },
    { number: "INV-2026-0880", handle: "foodie.gram", links: ["sample-link-12"], gst: false, status: "RAISED", payment: "PENDING", gstStatus: "PENDING", due: daysAhead(6), campaign: "sample-camp-swiggy" },
    { number: "INV-2026-0882", handle: "daily.dose", links: ["sample-link-13"], gst: false, status: "PAID", payment: "COMPLETED", gstStatus: "COMPLETED", due: daysAgo(12), paidAt: daysAgo(10), campaign: "sample-camp-swiggy" },
    { number: "INV-2026-0884", handle: "meme.mafia", links: ["sample-link-14"], gst: true, status: "PAID", payment: "COMPLETED", gstStatus: "COMPLETED", due: daysAgo(15), paidAt: daysAgo(13), campaign: "sample-camp-swiggy" },
  ];
  for (const inv of invoiceSeeds) {
    if (await prisma.invoice.findUnique({ where: { invoiceNumber: inv.number } })) continue;
    // InvoiceItem.linkId is unique — skip if any of these links was invoiced through the app meanwhile.
    if (await prisma.invoiceItem.findFirst({ where: { linkId: { in: inv.links.map((id) => links[id].id) } } })) continue;
    const owner = ownerByHandle[inv.handle];
    const items = inv.links.map((id) => ({ linkId: links[id].id, amount: Number(links[id].cost) }));
    const subtotal = items.reduce((s, i) => s + i.amount, 0);
    const gstAmount = inv.gst ? Math.round(subtotal * 0.18) : 0;
    await prisma.invoice.create({
      data: {
        creatorId: owner.id,
        campaignId: inv.campaign,
        raisedById: owner.id,
        invoiceNumber: inv.number,
        subtotal,
        isGstInvoice: inv.gst,
        gstAmount,
        amount: subtotal + gstAmount,
        status: inv.status,
        paymentStatus: inv.payment,
        gstStatus: inv.gstStatus,
        dueDate: inv.due,
        paidAt: inv.paidAt ?? null,
        createdAt: new Date(inv.due.getTime() - 15 * DAY),
        items: { create: items },
      },
    });
  }

  // ---- Plans: one per approval state, built from the pages above ----
  const planSeeds = [
    { id: "sample-plan-nykaa", name: "Nykaa Summer pitch", clientName: "Nykaa", clientCompany: "Nykaa E-Retail Pvt. Ltd.", budget: 450000, gstPercent: 18, status: "PENDING_APPROVAL", pages: ["meme.mafia", "trend.hub", "daily.dose", "style.diaries", "laugh.lab"], margin: 0.2 },
    { id: "sample-plan-cred", name: "Cred Pay launch", clientName: "Cred", clientCompany: "Dreamplug Technologies", budget: 300000, gstPercent: null, status: "DRAFT", pages: ["paisa.talk", "news.now", "daily.dose"], margin: 0.25 },
    { id: "sample-plan-myntra", name: "Myntra EORS memes", clientName: "Myntra", clientCompany: "Myntra Designs Pvt. Ltd.", budget: 200000, gstPercent: 18, status: "REJECTED", pages: ["meme.mafia", "laugh.lab"], margin: 0.15, notes: "Client wants only meme pages, no news." },
    { id: "sample-plan-boat", name: "Boat Nirvana wave 2", clientName: "Boat", clientCompany: "Imagine Marketing Ltd.", budget: 180000, gstPercent: null, status: "APPROVED", pages: ["news.now", "foodie.gram"], margin: 0.2 },
  ];
  for (const p of planSeeds) {
    if (await prisma.plan.findUnique({ where: { id: p.id } })) continue;
    const approved = p.status === "APPROVED";
    await prisma.plan.create({
      data: {
        id: p.id,
        name: p.name,
        clientName: p.clientName,
        clientCompany: p.clientCompany,
        clientContact: "+91 98000 00000",
        clientAddress: "Bengaluru, Karnataka",
        notes: p.notes ?? null,
        budget: p.budget,
        gstPercent: p.gstPercent,
        status: p.status,
        createdById: planner.id,
        approvedById: approved ? admin.id : null,
        approvedAt: approved ? daysAgo(3) : null,
        variantLabel: "Plan A",
        pitchGroupId: p.id,
        items: {
          create: p.pages.map((handle) => {
            const page = CREATORS.flatMap((c) => c.pages).find((pg) => pg.handle === handle);
            return { assetId: assetsByHandle[handle].id, format: "reel", cost: page.reel, clientCost: Math.round(page.reel * (1 + p.margin)), postsPerProfile: 1 };
          }),
        },
      },
    });
  }

  // ---- Billing profiles: every sample creator can be paid out ----
  for (const c of CREATORS) {
    const user = ownerByHandle[c.pages[0].handle];
    if (!user) continue;
    const existing = await prisma.billingProfile.findFirst({ where: { userId: user.id } });
    if (existing) continue;
    const initials = c.name.split(" ").map((w) => w[0]).join("").toUpperCase().padEnd(3, "X").slice(0, 3);
    await prisma.billingProfile.create({
      data: {
        userId: user.id,
        pan: `${initials}PK${String(1000 + CREATORS.indexOf(c)).slice(-4)}${c.name[0].toUpperCase()}`,
        name: c.name,
        gstin: CREATORS.indexOf(c) % 2 === 0 ? `27${initials}PK${String(1000 + CREATORS.indexOf(c)).slice(-4)}${c.name[0].toUpperCase()}1Z5` : null,
        bankAccountNumber: String(50100000000000 + CREATORS.indexOf(c) * 7919),
        ifscCode: "HDFC0001234",
        approvalStatus: "approved",
      },
    });
  }

  // ---- Execution: approved plans get their sheets, a campaign, matched
  // pages and approved posts — everything an invoice needs ----
  const SHEET = (slug) => `https://docs.google.com/spreadsheets/d/sample-${slug}/edit`;
  for (const p of planSeeds.filter((x) => x.status === "APPROVED")) {
    const plan = await prisma.plan.findUnique({ where: { id: p.id }, include: { items: { include: { asset: true } } } });
    if (!plan) continue;
    const campaignId = `sample-camp-plan-${p.id.replace("sample-plan-", "")}`;
    const distinct = [...new Set(plan.items.map((i) => i.assetId))];
    await prisma.campaign.upsert({
      where: { id: campaignId },
      create: {
        id: campaignId,
        brandName: plan.clientCompany || plan.clientName,
        title: plan.name,
        costCap: plan.budget ?? plan.items.reduce((sum, i) => sum + Number(i.cost) * i.postsPerProfile, 0),
        deadline: daysAhead(20),
        sheetLink: SHEET(`${p.id}-execution`),
        assignments: {
          create: distinct.map((assetId) => {
            const item = plan.items.find((i) => i.assetId === assetId);
            return { assetId, pageHandle: item.asset?.handle ?? "", format: item.format, cost: item.cost, status: "matched" };
          }),
        },
      },
      update: {},
    });
    await prisma.plan.update({
      where: { id: plan.id },
      data: {
        campaignId,
        clientSheetUrl: SHEET(`${p.id}-client`),
        internalSheetUrl: SHEET(`${p.id}-internal`),
        executionSheetUrl: SHEET(`${p.id}-execution`),
        clientGstNumber: plan.clientGstNumber ?? "27AABCU9603R1ZM",
      },
    });
    // One approved post per page, ready to invoice from the campaign page.
    for (const [idx, assetId] of distinct.entries()) {
      const item = plan.items.find((i) => i.assetId === assetId);
      const handle = item.asset?.handle ?? "page";
      const owner = ownerByHandle[handle];
      const linkId = `sample-link-plan-${p.id.replace("sample-plan-", "")}-${idx + 1}`;
      const link = await prisma.link.upsert({
        where: { id: linkId },
        create: {
          id: linkId,
          campaignId,
          assetId,
          submittedById: owner.id,
          url: `https://instagram.com/reel/P${idx + 1}x${handle.replace(".", "")}`,
          format: item.format,
          cost: item.cost,
          status: "INSIGHTS_APPROVED",
          postedAt: daysAgo(3 + idx),
          createdAt: daysAgo(3 + idx),
        },
        update: {},
      });
      if ((await prisma.linkStatusEvent.count({ where: { linkId: link.id } })) === 0) {
        for (const st of ["SUBMITTED", "PENDING_SCREENSHOT_REVIEW", "SCREENSHOT_APPROVED", "INSIGHTS_APPROVED"]) {
          await prisma.linkStatusEvent.create({ data: { linkId: link.id, status: st, actedById: st === "SUBMITTED" ? owner.id : admin.id } });
        }
      }
      await prisma.screenshot.upsert({ where: { linkId: link.id }, create: { linkId: link.id, publicId: `screenshots/${link.id}/sample`, approved: true, reviewedById: admin.id }, update: {} });
      if (!(await prisma.postSnapshot.findFirst({ where: { linkId: link.id } }))) {
        const page = CREATORS.flatMap((c) => c.pages).find((pg) => pg.handle === handle);
        await prisma.postSnapshot.create({ data: { linkId: link.id, likeCount: page?.likes ?? 1000, commentsCount: Math.round((page?.likes ?? 1000) / 40), videoViews: page?.views ?? 10000, videoPlayCount: page?.views ?? 10000, saves: 40, shares: 12, reposts: 2, caption: `${plan.clientName} × @${handle} #ad` } });
      }
      // Sheet row already named this post — reflect that on the assignment.
      await prisma.campaignAssignment.updateMany({ where: { campaignId, assetId, linkId: null }, data: { postUrl: link.url, linkId: link.id } });
    }
  }

  console.log("Sample data ready.", {
    creators: CREATORS.length,
    pages: Object.keys(assetsByHandle).length,
    campaigns: Object.keys(campaigns).length,
    links: Object.keys(links).length,
    invoices: invoiceSeeds.length,
    plans: planSeeds.length,
    planner: planner.phoneNumber,
  });
}
