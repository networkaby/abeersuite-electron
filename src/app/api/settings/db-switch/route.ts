import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { dbSwitchStatus, switchPrimary, SwitchRefused } from "@/shared/lib/db/dbSwitch.server";
import { envChecklist } from "@/shared/lib/db/envChecklist.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/settings/db-switch — DB1 / DB2, which is primary, last nightly copy, and
 *      whether the switch window is open. No URLs or passwords leave: project ref only.
 * POST /api/settings/db-switch — make staging the primary. Body { confirm: "SWITCH" }.
 *
 * Office only: a counter holds just the primary's pooled URL (counter/config), so it can
 * neither see staging nor switch.
 */
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;
    if (IS_COUNTER_PC) return Response.json({ error: "Open this on the office site." }, { status: 404 });
    const [status, checklist] = await Promise.all([dbSwitchStatus(), envChecklist()]);
    return Response.json({ ...status, checklist });
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_DB_SWITCH);
    if (response) return response;
    if (IS_COUNTER_PC) return Response.json({ error: "Open this on the office site." }, { status: 404 });

    const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
    if (body?.confirm !== "SWITCH") return Response.json({ error: "Type SWITCH to confirm." }, { status: 400 });

    try {
        const out = await switchPrimary();
        return Response.json({ ok: true, ...out, status: { ...(await dbSwitchStatus()), checklist: await envChecklist() } });
    } catch (e) {
        if (e instanceof SwitchRefused) return Response.json({ error: e.message }, { status: 409 });
        console.error("[db-switch] switch failed:", e);
        return Response.json({ error: `Switch failed: ${(e as Error).message}` }, { status: 500 });
    }
}
