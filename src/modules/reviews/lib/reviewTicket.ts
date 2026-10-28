import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { ReplyRefusedError, raiseLeadTicket } from "@/modules/message/lib/customerMessages";

/**
 * Raise a Help or Deal ticket from a review. The reviewer is never linked to a
 * customer — a name is not a person — so the ticket carries the name only, and
 * staff link the real customer on the ticket once they know who it is.
 * A review already on a ticket returns that ticket.
 */
export async function ticketFromReview(reviewId: number, userId: number, kind: "help" | "deal"): Promise<number> {
    const r = await prisma.review.findUnique({
        where: { id: reviewId },
        select: { platform: true, reviewerName: true, stars: true, comment: true, ticketId: true },
    });
    if (!r) throw new ReplyRefusedError("Review not found.");
    if (r.ticketId) return r.ticketId;

    const where = r.platform === "GOOGLE" ? "Google" : r.platform.charAt(0) + r.platform.slice(1).toLowerCase();
    const who = r.reviewerName ?? "someone";
    const stars = r.stars ? `${r.stars}★ ` : "";
    const ticketId = await raiseLeadTicket({
        kind,
        subject: `${stars}${where} review by ${who}`.slice(0, 120),
        notes: r.comment || "(no comment, stars only)",
        contactName: r.reviewerName,
        phone: null,
        owner: null,
        author: await buildActorSnapshot(userId),
        source: `${r.platform}_REVIEW`,
        from: `a ${where} review`,
    });
    await prisma.review.update({ where: { id: reviewId }, data: { ticketId } });
    return ticketId;
}
