import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { dbSwitchStatus, lockForSwitch, SwitchRefused, unlockPrimary } from "@/shared/lib/db/dbSwitch.server";
import { envChecklist } from "@/shared/lib/db/envChecklist.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/settings/db-switch — DB1 / DB2, which is primary (NEXT_PUBLIC_DB_PRIMARY),
 *      last copy into the standby, and whether the primary is locked. Project ref only —
 *      no URLs or passwords leave.
 * POST /api/settings/db-switch — { action: "lock", confirm: "LOCK" } makes the primary
 *      read-only after the checks (step 1 of a switch; step 2 is the Vercel setting and a
 *      redeploy). { action: "unlock" } undoes it.
 *
 * Office only: a counter holds just the primary's pooled URL (counter/config), so it can
 * neither see staging nor switch.
 */
async function withChecklist() {
    const status = await dbSwitchStatus();
    return { ...status, checklist: await envChecklist(status.copy) };
}

export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;
    if (IS_COUNTER_PC) return Response.json({ error: "Open this on the office site." }, { status: 404 });
    return Response.json(await withChecklist());
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_DB_SWITCH);
    if (response) return response;
    if (IS_COUNTER_PC) return Response.json({ error: "Open this on the office site." }, { status: 404 });

    const body = (await req.json().catch(() => null)) as { action?: string; confirm?: string } | null;
    try {
        if (body?.action === "unlock") {
            await unlockPrimary();
        } else if (body?.action === "lock") {
            if (body.confirm !== "LOCK") return Response.json({ error: "Type LOCK to confirm." }, { status: 400 });
            await lockForSwitch();
        } else {
            return Response.json({ error: "Unknown action." }, { status: 400 });
        }
        return Response.json({ ok: true, status: await withChecklist() });
    } catch (e) {
        if (e instanceof SwitchRefused) return Response.json({ error: e.message }, { status: 409 });
        console.error("[db-switch] failed:", e);
        return Response.json({ error: (e as Error).message }, { status: 500 });
    }
}
