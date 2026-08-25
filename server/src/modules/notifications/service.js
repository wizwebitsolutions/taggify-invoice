import { prisma } from "../../lib/prisma.js";

/**
 * Notifications are written synchronously as DB rows at the point of the
 * triggering event — no Redis pub/sub. Client polls GET /notifications.
 */
export async function notify(userId, type, payload = {}) {
  return prisma.notification.create({ data: { userId, type, payload } });
}

export async function listForUser(userId, { unreadOnly = false } = {}) {
  return prisma.notification.findMany({
    where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function markRead(userId, notificationId) {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(userId) {
  return prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
