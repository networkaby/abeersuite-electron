import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, userCanActOnVoucher } from "@/shared/lib/auth/permissions";
import { requireBranchAccess, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { branchAccessResponse } from "@/shared/lib/api/branchAccessResponse";
import { handleApiError } from "@/shared/lib/api";
import { auth } from "@/auth";
import { loadStockBeforeDate } from "@/modules/inventory/lib/liveStock";

// GET /api/inventory/products/stock-before?branchId=BR-HQ&date=2026-10-20&ids=1,2,3
//
// The Physical Stock screen's "In system" column: each product's stock in that
// branch at the START of the count date, opening included. It is the exact figure
// the post path subtracts the counted quantity from (loadStockBeforeDate), so the
// variance on screen is the adjustment the server will write.
//
// One request for every line on the voucher. Not HTTP-cached: the screen refetches
// on every "stock" realtime event, and a cached answer would undo that.
const MAX_IDS = 500;

export async function GET(req: NextRequest) {
    const { response, user } = await requireAuth();
    if (response) return response;
    if (!userCanActOnVoucher(user, "PHYSICAL_STOCK", "create")) {
        return NextResponse.json({ error: "Not allowed to record physical stock" }, { status: 403 });
    }

    const sp = req.nextUrl.searchParams;
    const branchId = sp.get("branchId") ?? "";
    const date = sp.get("date") ?? "";
    const ids = (sp.get("ids") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!branchId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ error: "branchId and date (YYYY-MM-DD) are required" }, { status: 400 });
    }
    if (ids.length > MAX_IDS) return NextResponse.json({ error: `At most ${MAX_IDS} products` }, { status: 400 });

    try {
        requireBranchAccess(await auth(), branchId);
    } catch (e) {
        if (e instanceof BranchAccessError) return branchAccessResponse(e);
        throw e;
    }

    try {
        const stock = await loadStockBeforeDate(prisma, ids, branchId, new Date(`${date}T00:00:00Z`));
        return NextResponse.json({ stock: Object.fromEntries(stock) });
    } catch (e) {
        return handleApiError(e, "Could not load stock");
    }
}
