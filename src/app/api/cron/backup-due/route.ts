import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { isDue } from "@/shared/lib/backup/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/backup-due — asked once an hour by backup-scheduled.yml.
 *
 * The workflow's cron is a dumb hourly tick; this answers whether that particular
 * hour is one the shop asked for. That inversion is what lets the schedule be edited
 * from Settings → Backup & Restore without committing to the repo.
 *
 * Guarded by CRON_SECRET, the same shared secret the Vercel cron route uses. It only
 * reveals a schedule, but an unauthenticated version could be hammered to mark
 * lastRunAt and thereby suppress a real backup.
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const row = await prisma.backupConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    const now = new Date();
    const result = isDue(row, now);

    // Stamped here rather than after the dump, because this is the only moment both
    // sides agree a run is starting. A dump that then fails leaves lastRunAt set and
    // skips the rest of the hour — the next scheduled hour still runs, and a failed
    // run is visible in the Dropbox log either way.
    if (result.due) {
        await prisma.backupConfig.update({ where: { id: 1 }, data: { lastRunAt: now } });
    }

    return NextResponse.json(result);
}
