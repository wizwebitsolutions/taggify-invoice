import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { notify } from "../notifications/service.js";

/**
 * Transitions a Link's status, writes the LinkStatusEvent that powers the
 * "status timeline" UI, and (optionally) notifies a user — all in one place
 * so no call site can move a Link's status without leaving a trace.
 *
 * INVOICED is terminal here (22 Sep): an invoice's amount is a snapshot of
 * its links, and the only thing that may release a link is rejecting that
 * invoice (invoices/service.js rejectInvoice, which writes the link row
 * directly, not through here). Before this guard a screenshot uploaded or
 * reviewed after invoicing silently moved the link back to a "ready to
 * invoice" status while its InvoiceItem stayed — so it showed up as
 * billable again and Generate failed with "already on invoice INV-…".
 */
export const ALREADY_INVOICED = (what = "change this link") =>
  new ApiError(409, "ALREADY_INVOICED", `This link is already on an invoice — reject that invoice before you ${what}`);

export async function transitionLinkStatus(linkId, status, { actedById, note, notifyUserId, notifyType } = {}) {
  const current = await prisma.link.findUnique({ where: { id: linkId }, select: { status: true } });
  if (!current) throw new ApiError(404, "LINK_NOT_FOUND", "Link not found");
  if (current.status === "INVOICED" && status !== "INVOICED") throw ALREADY_INVOICED();

  const [link] = await prisma.$transaction([
    prisma.link.update({ where: { id: linkId }, data: { status } }),
    prisma.linkStatusEvent.create({ data: { linkId, status, actedById, note } }),
  ]);

  if (notifyUserId && notifyType) {
    await notify(notifyUserId, notifyType, { linkId, status });
  }

  return link;
}
