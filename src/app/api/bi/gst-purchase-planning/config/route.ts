import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import {
    PLANNING_CONFIG_NUMBER_KEYS,
    loadBankAccountOptions,
    loadPlanningConfig,
    savePlanningConfig,
    validateBankAccountIds,
    type GstPlanningConfig,
} from "@/modules/bi/lib/gstPlanning";

// GET /api/bi/gst-purchase-planning/config — rules plus the bank ledger options
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    const [config, banks] = await Promise.all([loadPlanningConfig(), loadBankAccountOptions()]);
    return NextResponse.json({ ...config, banks });
}

// PATCH /api/bi/gst-purchase-planning/config — the rules and the permanent
// bank / OD selection, all of which apply to every month of every year.
export async function PATCH(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const body = await req.json() as Partial<GstPlanningConfig>;
    const patch: Partial<GstPlanningConfig> = {};

    for (const key of PLANNING_CONFIG_NUMBER_KEYS) {
        const value = body[key];
        if (value === undefined) continue;
        const n = Number(value);
        // The three rates are percentages; the tax-free limit is a rupee amount.
        const isPercent = key !== "incomeTaxFreeLimit";
        if (!Number.isFinite(n) || n < 0 || (isPercent && n > 100)) {
            return NextResponse.json(
                { error: isPercent ? `${key} must be between 0 and 100` : `${key} must be zero or more` },
                { status: 400 },
            );
        }
        patch[key] = n;
    }

    if (body.bankAccountIds !== undefined) {
        const ids = [...new Set(body.bankAccountIds.filter((id) => typeof id === "number" && id > 0))];
        if (!(await validateBankAccountIds(ids))) {
            return NextResponse.json({ error: "Invalid bank / OD account" }, { status: 400 });
        }
        patch.bankAccountIds = ids;
    }

    return NextResponse.json(await savePlanningConfig(patch));
}
