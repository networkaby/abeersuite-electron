import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/authGuard";
import { z } from "zod";
import {
    productOpeningValue, syncProductCacheFromOpening,
} from "@/modules/inventory/lib/stockValue";

// PUT /api/inventory/products/[id]/opening
// Sets opening stock qty, rate, and value on a product master.
const schema = z.object({
    qty:      z.number().nullable(),
    rate:     z.number().nullable(),
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("finance:opening-balance:manage");
    if (response) return response;

    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });

    // Map { qty, rate } → shared { openingStock, openingRate } shape so the
    // helpers in stockValue.ts can be reused.
    const opening = { openingStock: parsed.data.qty, openingRate: parsed.data.rate };

    try {
        const product = await prisma.invProduct.update({
            where: { id: Number(id) },
            data: {
                openingStock:     parsed.data.qty,
                openingRate:      parsed.data.rate,
                openingValue:     productOpeningValue(opening),
                openingStockDate: parsed.data.asOfDate ? new Date(parsed.data.asOfDate) : null,
                // Sync running caches via shared helper. Clearing opening
                // (qty = null) resets stock=0 and costPaise=null so the
                // closingStock helper doesn't keep stale valuation.
                ...syncProductCacheFromOpening(opening),
            },
        });
        return NextResponse.json(product);
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to update opening stock" }, { status: 500 });
    }
}
