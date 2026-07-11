import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { strategyPointsSaveSchema, type StrategyPoints } from "@/shared/lib/schemas/pricingSchemas";

// The single org-wide additive-margin points configuration.
//   GET  → the grouped points shape (base + per-master + per-band maps).
//   PUT  → replaces the whole set (zero-point entries are dropped).
// Gated by pricing:strategy:set (or the inventory:manage umbrella).

const emptyPoints = (): StrategyPoints => ({
    base: 0, brand: {}, category: {}, group: {}, product: {}, stockBand: {}, ageBand: {}, moveBand: {},
});

export async function GET() {
    const { response } = await requireAnyPermission(PERMISSIONS.PRICING_STRATEGY_SET);
    if (response) return response;
    try {
        const rows = await prisma.strategyPoint.findMany();
        const out = emptyPoints();
        for (const r of rows) {
            const v = Number(r.points);
            switch (r.dimension) {
                case "BASE":       out.base = v; break;
                case "BRAND":      out.brand[r.refKey] = v; break;
                case "CATEGORY":   out.category[r.refKey] = v; break;
                case "GROUP":      out.group[r.refKey] = v; break;
                case "PRODUCT":    out.product[r.refKey] = v; break;
                case "STOCK_BAND": out.stockBand[r.refKey] = v; break;
                case "AGE_BAND":   out.ageBand[r.refKey] = v; break;
                case "MOVE_BAND":  out.moveBand[r.refKey] = v; break;
            }
        }
        return NextResponse.json(out);
    } catch (e) {
        return handleApiError(e, "Failed to load strategy points");
    }
}

export async function PUT(req: Request) {
    const { response } = await requireAnyPermission(PERMISSIONS.PRICING_STRATEGY_SET);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, strategyPointsSaveSchema);
        if (error) return error;

        const entries: { dimension: "BASE" | "BRAND" | "CATEGORY" | "GROUP" | "PRODUCT" | "STOCK_BAND" | "AGE_BAND" | "MOVE_BAND"; refKey: string; points: number }[] = [];
        if (data.base !== 0) entries.push({ dimension: "BASE", refKey: "", points: data.base });
        const add = (dimension: "BRAND" | "CATEGORY" | "GROUP" | "PRODUCT" | "STOCK_BAND" | "AGE_BAND" | "MOVE_BAND", map: Record<string, number>) => {
            for (const [refKey, points] of Object.entries(map)) {
                if (points !== 0 && refKey.trim() !== "") entries.push({ dimension, refKey, points });
            }
        };
        add("BRAND", data.brand);
        add("CATEGORY", data.category);
        add("GROUP", data.group);
        add("PRODUCT", data.product);
        add("STOCK_BAND", data.stockBand);
        add("AGE_BAND", data.ageBand);
        add("MOVE_BAND", data.moveBand);

        // Replace the whole set atomically.
        await prisma.$transaction([
            prisma.strategyPoint.deleteMany({}),
            ...(entries.length ? [prisma.strategyPoint.createMany({ data: entries })] : []),
        ]);

        return NextResponse.json({ saved: entries.length });
    } catch (e) {
        return handleApiError(e, "Failed to save strategy points");
    }
}
