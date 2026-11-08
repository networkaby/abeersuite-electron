import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { createSystemInboxNotificationsForUsers } from "@/modules/message/lib/inbox";
import { pushNoticesToStaff } from "@/shared/lib/push/staffPush";

/**
 * A ticket (help, deal, …) was just given to a seat: tell everyone holding that
 * seat — except whoever assigned it — with an Inbox message and a phone /
 * browser push. The ticket itself shows in their Work Flow on its own
 * (workLessInboxCandidates). Never throws: the save already succeeded.
 */
export async function notifySeatAssigned(opts: {
    positionId: string;
    seatTitle: string;
    actorUserId: number;
    kind: string;      // "Help ticket", "Deal", …
    ticketId: number;
    title: string | null;
    url: string;
}): Promise<void> {
    try {
        const holders = await prisma.userPosition.findMany({
            where: { positionId: opts.positionId, userId: { not: opts.actorUserId } },
            select: { userId: true },
        });
        const userIds = [...new Set(holders.map((h) => h.userId))];
        if (userIds.length === 0) return;
        const title = `${opts.kind} #${opts.ticketId} assigned to you`;
        const body = `${opts.title?.trim() || opts.kind} — assigned to ${opts.seatTitle}`;
        await createSystemInboxNotificationsForUsers({ userIds, title, body, link: opts.url });
        await pushNoticesToStaff([{ title, body, url: opts.url, tag: `assign-${opts.ticketId}` }], userIds);
    } catch (e) {
        console.error("[assign-notice] failed", e);
    }
}
