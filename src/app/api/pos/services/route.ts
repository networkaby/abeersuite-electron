import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

// GET /api/pos/services — the ACTIVE service catalogue for the POS search box.
// Lightweight cashier-facing read: id, name, tax rate (resolved to a number)
// and the optional default tax-inclusive price. The income ledger stays
// server-side — /api/pos/sale re-resolves it from the id on post.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const rows = await prisma.posService.findMany({
            where:   { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: {
                id: true, name: true, defaultPricePaise: true,
                gstRate: { select: { rate: true } },
            },
        });
        return NextResponse.json(rows.map((r) => ({
            id:                r.id,
            name:              r.name,
            taxRate:           r.gstRate ? Number(r.gstRate.rate) : 0,
            defaultPricePaise: r.defaultPricePaise,
        })));
    } catch (e) {
        return handleApiError(e, "Failed to fetch POS services");
    }
}
