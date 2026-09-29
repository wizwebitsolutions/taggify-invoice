// One-off: `node scripts/backfill-post-quota.js` (dry run) or
// `node scripts/backfill-post-quota.js --apply` — sets Link.overQuota for every
// post that already exists, using the same rule as lib/postQuota.js. The flag
// only gets maintained going forward from when that code shipped, so rows
// created before it all start at `false`.
//
// This changes what's payable (an over-quota post leaves dues, invoices and
// payouts), so the default is a dry run that prints exactly which posts would
// flip and how much money moves. Nothing is written without --apply.
import { prisma } from "../src/lib/prisma.js";
import { overQuotaIds, isPaidLink } from "../src/lib/postQuota.js";

const apply = process.argv.includes("--apply");

const campaigns = await prisma.campaign.findMany({ select: { id: true, title: true, parentCampaignId: true, phaseNumber: true } });
const groupOf = new Map(campaigns.map((c) => [c.id, `${c.parentCampaignId ?? c.id}|${c.phaseNumber}`]));
const titleOf = new Map(campaigns.map((c) => [groupOf.get(c.id), c.title]));

const links = await prisma.link.findMany({
  select: {
    id: true,
    url: true,
    cost: true,
    campaignId: true,
    assetId: true,
    postedAt: true,
    createdAt: true,
    overQuota: true,
    asset: { select: { handle: true } },
    invoiceItem: { select: { invoice: { select: { invoiceNumber: true, status: true } } } },
    payoutItem: { select: { payout: { select: { status: true } } } },
  },
});
// Same "a paid post keeps its slot" rule as lib/postQuota.js's recompute.
for (const l of links) l.paid = isPaidLink(l);
const assignments = await prisma.campaignAssignment.findMany({ where: { assetId: { not: null } }, select: { campaignId: true, assetId: true } });

const key = (campaignId, assetId) => `${groupOf.get(campaignId)}#${assetId}`;
const booked = new Map();
for (const a of assignments) booked.set(key(a.campaignId, a.assetId), (booked.get(key(a.campaignId, a.assetId)) ?? 0) + 1);
const byPage = new Map();
for (const l of links) byPage.set(key(l.campaignId, l.assetId), [...(byPage.get(key(l.campaignId, l.assetId)) ?? []), l]);

const toFlag = [];
const toClear = [];
for (const [pageKey, pageLinks] of byPage) {
  const slots = booked.get(pageKey) ?? 0;
  const over = overQuotaIds(pageLinks, slots);
  const flips = pageLinks.filter((l) => over.has(l.id) !== l.overQuota);
  if (flips.length === 0) continue;

  const [group] = pageKey.split("#");
  console.log(`\n${titleOf.get(group) ?? group} → @${pageLinks[0].asset?.handle}: booked ${slots}, posted ${pageLinks.length}`);
  for (const l of flips) {
    const nowOver = over.has(l.id);
    (nowOver ? toFlag : toClear).push(l);
    const inv = l.invoiceItem?.invoice;
    console.log(`   ${nowOver ? "OVER " : "clear"} ₹${Number(l.cost).toLocaleString("en-IN")}  ${l.url}${inv ? `  (on ${inv.invoiceNumber}, ${inv.status})` : ""}`);
  }
}

const money = (rows) => rows.reduce((s, l) => s + Number(l.cost), 0).toLocaleString("en-IN");
console.log(`\n${toFlag.length} post(s) become over quota (₹${money(toFlag)}), ${toClear.length} cleared (₹${money(toClear)}).`);

if (!apply) {
  console.log("Dry run — nothing written. Re-run with --apply to save these flags.");
} else {
  if (toFlag.length > 0) await prisma.link.updateMany({ where: { id: { in: toFlag.map((l) => l.id) } }, data: { overQuota: true } });
  if (toClear.length > 0) await prisma.link.updateMany({ where: { id: { in: toClear.map((l) => l.id) } }, data: { overQuota: false } });
  console.log("Applied.");
}

await prisma.$disconnect();
