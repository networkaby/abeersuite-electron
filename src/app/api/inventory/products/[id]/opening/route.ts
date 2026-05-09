import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

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

    const value = parsed.data.qty != null && parsed.data.rate != null
        ? parsed.data.qty * parsed.data.rate
        : null;

    try {
        const product = await prisma.invProduct.update({
            where: { id: Number(id) },
            data: {
                openingStock:     parsed.data.qty,
                openingRate:      parsed.data.rate,
                openingValue:     value,
                openingStockDate: parsed.data.asOfDate ? new Date(parsed.data.asOfDate) : null,
                // Sync the running caches so reports light up immediately.
                // Same baseline rule as POST/PATCH /api/inventory/products:
                // opening qty seeds `stock`, opening rate seeds `costPaise`.
                // Clearing opening (qty = null) resets both back to zero so
                // closingStock helper doesn't keep the stale valuation.
                stock:     parsed.data.qty != null ? Math.round(parsed.data.qty) : 0,
                costPaise: parsed.data.rate != null ? Math.round(parsed.data.rate * 100) : null,
            },
        });
        return NextResponse.json(product);
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to update opening stock" }, { status: 500 });
    }
}
