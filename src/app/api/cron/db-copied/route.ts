import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { isDbId } from "@/shared/lib/db/dbTargets";
import { markCopyFinished } from "@/shared/lib/db/dbSwitch.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/db-copied — backup.yml reports the nightly copy into staging.
 * Body { into: "DB1" | "DB2", ok: boolean }. Same key as /api/cron/backup (CRON_SECRET or
 * the Incoming API cron key).
 *
 * A false "ok" cannot open the switch window on its own: the switch also compares every
 * table on both databases and refuses on any difference.
 */
export async function POST(req: Request) {
    if (!(await requireIncomingKey(req, "CRON"))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = (await req.json().catch(() => null)) as { into?: unknown; ok?: unknown } | null;
    if (!isDbId(body?.into) || typeof body?.ok !== "boolean") {
        return Response.json({ error: "Body must be { into: 'DB1' | 'DB2', ok: boolean }." }, { status: 400 });
    }
    try {
        return Response.json(await markCopyFinished(body.into, body.ok));
    } catch (e) {
        console.error("[cron/db-copied] could not record the copy:", e);
        return Response.json({ error: (e as Error).message }, { status: 500 });
    }
}
