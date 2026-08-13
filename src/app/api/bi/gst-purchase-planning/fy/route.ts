import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { r2 } from "@/modules/bi/lib/marginEngine";
import { loadBankAccountOptions, loadGstPlanningFy, upsertFyRow } from "@/modules/bi/lib/gstPlanning";

export const maxDuration = 60;

function parseFyStartYear(value: unknown): number | null {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 2000 || n > 2100) return null;
    return n;
}

// GET /api/bi/gst-purchase-planning/fy?fy=2026&branchId=
// fy=2026 means FY 2026-27 (April 2026 → March 2027).
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const raw = searchParams.get("fy");
    const now = new Date();
    const currentFy = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
    const fyStartYear = raw ? parseFyStartYear(raw) : currentFy;
    if (fyStartYear === null) {
        return NextResponse.json({ error: "Invalid financial year" }, { status: 400 });
    }

    const branchId = searchParams.get("branchId") || null;
    const [banks, result] = await Promise.all([
        loadBankAccountOptions(),
        loadGstPlanningFy(fyStartYear, { branchId }),
    ]);

    return NextResponse.json({ branchId, banks, ...result });
}

// PATCH /api/bi/gst-purchase-planning/fy — the FY cost limit / extra cost paid.
// Bank selection is permanent and lives on the /config route.
export async function PATCH(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const body = await req.json() as {
        fyStartYear?: number;
        costLimit?: number;
        extraCostPaid?: number;
    };

    const fyStartYear = parseFyStartYear(body.fyStartYear);
    if (fyStartYear === null) {
        return NextResponse.json({ error: "fyStartYear required" }, { status: 400 });
    }

    const costLimit = body.costLimit !== undefined ? Number(body.costLimit) : undefined;
    const extraCostPaid = body.extraCostPaid !== undefined ? Number(body.extraCostPaid) : undefined;
    if ((costLimit !== undefined && (!Number.isFinite(costLimit) || costLimit < 0))
        || (extraCostPaid !== undefined && (!Number.isFinite(extraCostPaid) || extraCostPaid < 0))) {
        return NextResponse.json({ error: "Amounts must be zero or more" }, { status: 400 });
    }

    await upsertFyRow(fyStartYear, {
        ...(costLimit !== undefined ? { costLimit: r2(costLimit) } : {}),
        ...(extraCostPaid !== undefined ? { extraCostPaid: r2(extraCostPaid) } : {}),
    });

    const [banks, result] = await Promise.all([
        loadBankAccountOptions(),
        loadGstPlanningFy(fyStartYear),
    ]);
    return NextResponse.json({ banks, ...result });
}
