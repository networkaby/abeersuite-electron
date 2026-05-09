import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const updateSchema = z.object({
    prefix:    z.string().max(30).optional(),
    suffix:    z.string().max(30).optional(),
    startFrom: z.number().int().min(1).optional(),
    padWidth:  z.number().int().min(1).max(10).optional(),
});

// PATCH /api/finance/voucher-series/[kind]
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ kind: string }> },
) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    const { kind } = await params;

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }

    try {
        const series = await prisma.voucherSeries.update({
            where: { kind },
            data: parsed.data,
        });
        return NextResponse.json(series);
    } catch {
        return NextResponse.json({ error: "Voucher series not found" }, { status: 404 });
    }
}
