import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { sendPushToPerson } from "@/shared/lib/push/sendPush";
import { campaignBody } from "@/modules/campaigns/lib/campaign";

/** Customers pushed to at once — keeps Google's and the DB's load gentle. */
const BATCH = 10;

/** PushMessage.refType for a campaign's messages; refId = String(campaign id). */
export const CAMPAIGN_REF = "CAMPAIGN";

/**
 * Push one campaign to every customer with notifications on. Runs after the
 * response (the campaign is already marked SENT, so it can never go twice).
 * Never throws: sendPushToPerson swallows a failed device, and a crash part-way
 * only means fewer customers got it — the results show how many did.
 */
export async function sendCampaign(id: number): Promise<void> {
    try {
        const c = await prisma.campaign.findUnique({
            where: { id },
            select: { title: true, body: true, url: true, coupon: { select: { code: true } } },
        });
        if (!c) return;
        const people = await prisma.pushSubscription.findMany({ distinct: ["personId"], select: { personId: true } });
        const payload = {
            title: c.title,
            body: campaignBody(c.body, c.coupon?.code ?? null),
            url: c.url ?? "/",
            tag: `campaign-${id}`,
            refType: CAMPAIGN_REF,
            refId: String(id),
        };
        for (let i = 0; i < people.length; i += BATCH) {
            await Promise.all(people.slice(i, i + BATCH).map((p) => sendPushToPerson(p.personId, payload)));
        }
    } catch (e) {
        console.error("[campaign] send failed", id, e);
    }
}

export type CampaignStats = { customers: number; reached: number; shown: number; tapped: number };

/** Per campaign: customers messaged, reached (push service took it), shown on the phone, tapped. */
export async function campaignStats(ids: number[]): Promise<Record<number, CampaignStats>> {
    if (ids.length === 0) return {};
    const refIds = ids.map(String);
    const where = { refType: CAMPAIGN_REF, refId: { in: refIds } };
    const [all, reached, shown, tapped] = await Promise.all([
        prisma.pushMessage.groupBy({ by: ["refId"], where, _count: { _all: true } }),
        prisma.pushMessage.groupBy({ by: ["refId"], where: { ...where, reachedCount: { gt: 0 } }, _count: { _all: true } }),
        prisma.pushMessage.groupBy({ by: ["refId"], where: { ...where, shownAt: { not: null } }, _count: { _all: true } }),
        prisma.pushMessage.groupBy({ by: ["refId"], where: { ...where, clickedAt: { not: null } }, _count: { _all: true } }),
    ]);
    const out: Record<number, CampaignStats> = {};
    const add = (rows: { refId: string | null; _count: { _all: number } }[], key: keyof CampaignStats) => {
        for (const r of rows) {
            const id = Number(r.refId);
            out[id] ??= { customers: 0, reached: 0, shown: 0, tapped: 0 };
            out[id][key] = r._count._all;
        }
    };
    add(all, "customers");
    add(reached, "reached");
    add(shown, "shown");
    add(tapped, "tapped");
    return out;
}
