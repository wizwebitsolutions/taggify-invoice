// One-off: `npm run repair:invoiced-links` — see src/lib/repairInvoicedLinks.js.
import { prisma } from "../src/lib/prisma.js";
import { repairInvoicedLinks } from "../src/lib/repairInvoicedLinks.js";

const { repaired } = await repairInvoicedLinks();
if (repaired.length === 0) console.log("Nothing to repair — every link on a live invoice is already INVOICED.");
for (const r of repaired) console.log(`INVOICED  ${r.url}  (was ${r.from}, on ${r.invoiceNumber})`);
await prisma.$disconnect();
