import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { r2 } from "@/modules/bi/lib/marginEngine";
import {
    fyStartYearOf,
    loadGstPartyPurchases,
    loadGstPlanningFy,
    monthBounds,
    monthLabel,
    upsertGstPlanningMonth,
    type MonthPatch,
} from "@/modules/bi/lib/gstPlanning";

export const maxDuration = 60;

/** Override input: a number sets it, null clears it back to the computed value. */
function parseOverride(value: unknown): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    return r2(n);
}

// GET /api/bi/gst-purchase-planning?month=2026-08&branchId=
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const yearMonth = searchParams.get("month");
    if (!yearMonth) {
        return NextResponse.json({ error: "month query param required (YYYY-MM)" }, { status: 400 });
    }

    let from: Date;
    let to: Date;
    try {
        ({ from, to } = monthBounds(yearMonth));
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid month" }, { status: 400 });
    }

    const branchId = searchParams.get("branchId") || null;
    const fyStartYear = fyStartYearOf(yearMonth);

    // Cost carries forward across months, so the month is read off the FY walk
    // rather than recomputed on its own.
    const [partyRows, fyResult] = await Promise.all([
        loadGstPartyPurchases(from, to, branchId),
        loadGstPlanningFy(fyStartYear, { branchId }),
    ]);

    const row = fyResult.months.find((m) => m.yearMonth === yearMonth);
    if (!row) {
        return NextResponse.json({ error: "Month not found in its financial year" }, { status: 500 });
    }

    return NextResponse.json({
        yearMonth,
        monthLabel: monthLabel(yearMonth),
        branchId,
        config: fyResult.config,
        figures: {
            purchase: row.purchase,
            sale: row.sale,
            deposit: row.deposit,
        },
        month: {
            valueAddition: row.valueAddition,
            outputTax: row.outputTax,
            inputTax: row.inputTax,
            cost: row.cost,
            carriedIn: row.carriedIn,
            finalPayable: row.finalPayable,
            maxDeposit: row.maxDeposit,
            depositRoom: row.depositRoom,
            depositCarriedIn: row.depositCarriedIn,
            depositLimitLeft: row.depositLimitLeft,
            depositExcess: row.depositExcess,
            depositOk: row.depositOk,
        },
        fy: {
            fyStartYear,
            allowedDiff: fyResult.fy.allowedDiff,
        },
        meta: {
            purchaseBills: partyRows.reduce((s, r) => s + r.purchaseBills, 0),
            partyCount: partyRows.length,
        },
        rows: partyRows,
    });
}

// PATCH /api/bi/gst-purchase-planning — save this month's overrides.
// Bank selection is a per-FY setting; it lives on the /fy route.
export async function PATCH(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const body = await req.json() as {
        yearMonth?: string;
        purchaseOverride?: number | null;
        saleOverride?: number | null;
        depositOverride?: number | null;
    };

    if (!body.yearMonth) {
        return NextResponse.json({ error: "yearMonth required" }, { status: 400 });
    }

    try {
        monthBounds(body.yearMonth);
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid month" }, { status: 400 });
    }

    const patch: MonthPatch = {
        purchaseOverride: parseOverride(body.purchaseOverride),
        saleOverride: parseOverride(body.saleOverride),
        depositOverride: parseOverride(body.depositOverride),
    };

    const row = await upsertGstPlanningMonth(body.yearMonth, patch);

    return NextResponse.json({
        yearMonth: row.yearMonth,
        purchaseOverride: row.purchaseOverride != null ? toNumber(row.purchaseOverride) : null,
        saleOverride: row.saleOverride != null ? toNumber(row.saleOverride) : null,
        depositOverride: row.depositOverride != null ? toNumber(row.depositOverride) : null,
    });
}
