import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { isPushConfigured, sendPushToPerson } from "@/shared/lib/push/sendPush";
import { queuedPushPayload } from "@/shared/lib/whatsapp/notifyBill";
import { sendQueuedEmails } from "@/shared/lib/email/notifyEmail";

/**
 * The office sends what counters left queued in Supabase. A counter under
 * `WRITE_MODE=live` sends the WhatsApp itself but holds no push / email keys, so
 * it writes BillNotification.pushStatus = "queued" and an EmailNotification row
 * with status "queued" (notifyBill.ts). Run by /api/cron/communications.
 *
 * Each row is taken with one atomic update (queued → pending), so two runs at
 * once still send it once. Rows older than a day are left alone — a late "your
 * bill" notification is worse than none.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LIMIT = 100;

export async function runCounterQueue(): Promise<{ push: number; email: number }> {
    if (IS_COUNTER_PC) return { push: 0, email: 0 };
    const since = new Date(Date.now() - MAX_AGE_MS);
    const [push, email] = await Promise.all([sendQueuedPushes(since), sendQueuedEmails(since, LIMIT)]);
    return { push, email };
}

async function sendQueuedPushes(since: Date): Promise<number> {
    if (!isPushConfigured()) return 0;
    const rows = await prisma.billNotification.findMany({
        where: { pushStatus: "queued", createdAt: { gte: since } },
        select: { id: true, kind: true, refId: true },
        orderBy: { id: "asc" },
        take: LIMIT,
    });
    let sent = 0;
    for (const r of rows) {
        const { count } = await prisma.billNotification.updateMany({ where: { id: r.id, pushStatus: "queued" }, data: { pushStatus: "pending" } });
        if (!count) continue;
        let status = "failed";
        let messageId: string | null = null;
        try {
            const job = await queuedPushPayload(r.kind, r.refId);
            if (!job) status = "no-person";
            else ({ status, messageId } = await sendPushToPerson(job.personId, job.payload));
        } catch (e) {
            console.error(`[counter-queue] push ${r.kind} ${r.refId} failed`, e);
        }
        await prisma.billNotification.update({ where: { id: r.id }, data: { pushStatus: status, pushMessageId: messageId } });
        if (status === "sent") sent++;
    }
    return sent;
}
