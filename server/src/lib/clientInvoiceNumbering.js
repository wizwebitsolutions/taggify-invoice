import { prisma } from "./prisma.js";

/**
 * Proforma Invoice numbering (user request, 17 Sep — "invoice no. will be
 * set by admin and counter like will be generated on each pi generated,
 * admin, finance will have power to change invoice no. prefix"). A prefix
 * plus a running counter that never resets, both kept in AppSetting.
 */
const PREFIX_KEY = "clientInvoicePrefix";
const NEXT_KEY = "clientInvoiceNextNumber";
export const DEFAULT_PREFIX = "PI-";
const PAD = 4;

export const formatInvoiceNumber = (prefix, n) => `${prefix}${String(n).padStart(PAD, "0")}`;

export async function getNumbering(db = prisma) {
  const rows = await db.appSetting.findMany({ where: { key: { in: [PREFIX_KEY, NEXT_KEY] } } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const prefix = byKey.get(PREFIX_KEY) ?? DEFAULT_PREFIX;
  const nextNumber = Math.max(1, Number.parseInt(byKey.get(NEXT_KEY) ?? "1", 10) || 1);
  return { prefix, nextNumber, suggestion: formatInvoiceNumber(prefix, nextNumber) };
}

async function put(db, key, value) {
  await db.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function setNumbering({ prefix, nextNumber }) {
  if (prefix !== undefined) await put(prisma, PREFIX_KEY, prefix);
  if (nextNumber !== undefined) await put(prisma, NEXT_KEY, String(nextNumber));
  return getNumbering();
}

/**
 * Moves the counter past `invoiceNumber` when it belongs to the current
 * series (prefix + digits). A hand-typed number outside the series leaves
 * the counter alone, and one below the counter never moves it backwards.
 */
export async function advancePast(invoiceNumber) {
  // Read-then-write in one serializable transaction: two invoices saved at
  // once must not let the slower one write the counter back down. A
  // serialization conflict (P2034) just means the other writer won; one
  // more pass re-reads their value.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const { prefix, nextNumber } = await getNumbering(tx);
          if (!invoiceNumber.startsWith(prefix)) return;
          const tail = invoiceNumber.slice(prefix.length);
          // Digits only, and short enough to stay an exact integer — a
          // 22-digit tail would parse to 1e22 and corrupt the counter.
          if (!/^\d{1,8}$/.test(tail)) return;
          const used = Number.parseInt(tail, 10);
          if (used >= nextNumber) await put(tx, NEXT_KEY, String(used + 1));
        },
        { isolationLevel: "Serializable" }
      );
      return;
    } catch (err) {
      if (err?.code !== "P2034" || attempt === 2) throw err;
    }
  }
}
