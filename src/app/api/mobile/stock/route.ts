import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { loadLiveStockMap } from "@/modules/inventory/lib/liveStock";

const PAGE_SIZE = 30;

// GET /api/mobile/stock?q=<text>&page=<n>
//
// The phone app's product search: one page of active products matching the name,
// SKU or any code (barcode, part no.), with available quantity and sale price.
// Paged in the DB and summed only for the page shown, so a phone never pulls the
// whole catalogue the way the POS picker does.
export async function GET(req: NextRequest) {
    const { response } = await requirePermission(PERMISSIONS.MOBILE_STOCK_VIEW);
    if (response) return response;

    try {
        const params = req.nextUrl.searchParams;
        const q = (params.get("q") ?? "").trim();
        const page = Math.max(0, Number.parseInt(params.get("page") ?? "0", 10) || 0);

        const words = q.split(/\s+/).filter(Boolean).slice(0, 5);
        const rows = await prisma.invProduct.findMany({
            where: {
                isActive: true,
                // Every word must hit somewhere, so "hp 15 laptop" narrows rather than widens.
                AND: words.map((w) => ({
                    OR: [
                        { name: { contains: w, mode: "insensitive" as const } },
                        { sku: { contains: w, mode: "insensitive" as const } },
                        { codes: { some: { value: { contains: w, mode: "insensitive" as const } } } },
                    ],
                })),
            },
            orderBy: { name: "asc" },
            skip: page * PAGE_SIZE,
            take: PAGE_SIZE + 1,
            select: {
                id: true,
                sku: true,
                name: true,
                openingStock: true,
                openingBranchId: true,
                effectiveSalePricePaise: true,
                mrpPaise: true,
                unit: { select: { code: true } },
            },
        });

        const shown = rows.slice(0, PAGE_SIZE);
        const stock = await loadLiveStockMap(shown);

        return NextResponse.json({
            items: shown.map((p) => ({
                id: p.id,
                sku: p.sku,
                name: p.name,
                unit: p.unit?.code ?? null,
                stock: stock.get(p.id) ?? null,
                salePricePaise: p.effectiveSalePricePaise,
                mrpPaise: p.mrpPaise,
            })),
            hasMore: rows.length > PAGE_SIZE,
        });
    } catch (e) {
        return handleApiError(e, "Product search failed");
    }
}
