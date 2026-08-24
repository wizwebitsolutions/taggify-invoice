import { prisma } from "../../lib/prisma.js";
import { notify } from "../notifications/service.js";

/**
 * Transitions a Link's status, writes the LinkStatusEvent that powers the
 * "status timeline" UI, and (optionally) notifies a user — all in one place
 * so no call site can move a Link's status without leaving a trace.
 */
export async function transitionLinkStatus(linkId, status, { actedById, note, notifyUserId, notifyType } = {}) {
  const [link] = await prisma.$transaction([
    prisma.link.update({ where: { id: linkId }, data: { status } }),
    prisma.linkStatusEvent.create({ data: { linkId, status, actedById, note } }),
  ]);

  if (notifyUserId && notifyType) {
    await notify(notifyUserId, notifyType, { linkId, status });
  }

  return link;
}
