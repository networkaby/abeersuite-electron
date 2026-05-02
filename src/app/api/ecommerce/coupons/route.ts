import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const bodySchema = z.object({
    code: z.string().trim().min(1),
    percentOff: z.coerce.number().int().min(1).max(100).optional().nullable(),
    flatPaise: z.coerce.number().int().min(1).optional().nullable(),
    isActive: z.boolean().optional(),
    expiresAt: z.union([z.string(), z.literal("")]).optional().nullable(),
}).refine((d) => d.percentOff != null || d.flatPaise != null, {
    message: "Set percentOff or flatPaise",
});

export async function GET() {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    try {
        const rows = await prisma.shopCoupon.findMany({ orderBy: { createdAt: "desc" } });
        return NextResponse.json(rows);
    } catch {
        return NextResponse.json({ error: "Failed to list coupons" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const b = parsed.data;
    try {
        const row = await prisma.shopCoupon.create({
            data: {
                code: b.code.toUpperCase(),
                percentOff: b.percentOff ?? null,
                flatPaise: b.flatPaise ?? null,
                isActive: b.isActive ?? true,
                expiresAt:
                    b.expiresAt && String(b.expiresAt).trim() !== ""
                        ? new Date(b.expiresAt as string)
                        : null,
            },
        });
        return NextResponse.json(row, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Failed to create coupon (duplicate code?)" }, { status: 500 });
    }
}
