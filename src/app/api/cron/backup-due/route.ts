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
 * CRON_SECRET is OPTIONAL, matching /api/cron/backup. Unset, empty, or whitespace
 * means the check is skipped. Worth setting: this endpoint stamps lastRunAt, so an
 * open one could be hammered to suppress a real backup. But requiring it would be
 * worse — a missing variable on either side would stop backups silently, and the
 * failure would look identical to the app being down.
 *
 * A blank value counts as absent on purpose: a half-filled env var must not be able
 * to lock the scheduler out.
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET?.trim();
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
