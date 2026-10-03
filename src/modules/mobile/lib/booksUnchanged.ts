import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { isUnchangedSince } from "@/modules/accountancy/lib/aggregateLedger";
import { parseSince } from "@/shared/lib/prisma/counterMode";
import { MOBILE_SINCE_TRUST_MS } from "@/shared/lib/constants/polling";

/**
 * "Has anything in the books moved since the phone's copy?" — answered from two
 * indexed probes, so a phone re-opening a screen nobody has posted to costs
 * almost nothing instead of the screen's whole recompute.
 *
 *   • a voucher written, edited, posted or cancelled since (`isUnchangedSince`,
 *     the finance top bar's check, with the phone's own trust window);
 *   • a voucher DELETED since — a hard delete leaves no row for the first probe
 *     to see; its recycle-bin audit row is the only trace, written in the same
 *     transaction (the office Day Book reads deletions the same way).
 *
 * False whenever `since` is missing, unreadable or older than the trust window.
 */
export async function booksUnchangedSince(sinceParam: string | null, now: Date): Promise<boolean> {
    if (!(await isUnchangedSince(sinceParam, now, MOBILE_SINCE_TRUST_MS))) return false;
    const deleted = await prisma.auditLog.findFirst({
        where: { createdAt: { gt: parseSince(sinceParam)! } },
        select: { id: true },
    });
    return deleted === null;
}
