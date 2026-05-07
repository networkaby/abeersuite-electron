import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const TARGET_TYPES = ["INVOICE", "VOUCHER", "JOURNAL_ENTRY"] as const;
const SOURCE_TYPES = ["VOUCHER", "PAYMENT", "INVOICE", "JOURNAL_ENTRY"] as const;
const METHODS = ["NEW_REF", "AGAINST_REF", "ADVANCE", "ON_ACCOUNT"] as const;

const createSchema = z.object({
    targetType: z.enum(TARGET_TYPES),
    targetId:   z.number().int().positive(),
    sourceType: z.enum(SOURCE_TYPES),
    sourceId:   z.number().int().positive(),
    amount:     z.number().positive(),
    method:     z.enum(METHODS),
    reference:  z.string().trim().optional(),
});

// GET /api/finance/allocations?targetType=INVOICE&targetId=42
// Lists allocations linked to a particular target (or by source if ?sourceType=&sourceId=).
export async function GET(req: Request) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const targetType = searchParams.get("targetType") as typeof TARGET_TYPES[number] | null;
    const targetId   = searchParams.get("targetId") ? Number(searchParams.get("targetId")) : null;
    const sourceType = searchParams.get("sourceType") as typeof SOURCE_TYPES[number] | null;
    const sourceId   = searchParams.get("sourceId") ? Number(searchParams.get("sourceId")) : null;

    const allocations = await prisma.voucherAllocation.findMany({
        where: {
            ...(targetType && targetId ? { targetType, targetId } : {}),
            ...(sourceType && sourceId ? { sourceType, sourceId } : {}),
        },
        include: { createdBy: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: "desc" }],
    });
    return NextResponse.json(allocations);
}

// POST /api/finance/allocations
// Create a free-form bill-wise link between any two vouchers.
export async function POST(req: Request) {
    const { user, response } = await requirePermission("finance:allocation:manage");
    if (response) return response;

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });

    try {
        const allocation = await prisma.voucherAllocation.create({
            data: { ...parsed.data, createdById: user!.id },
        });
        return NextResponse.json(allocation, { status: 201 });
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to create allocation" }, { status: 500 });
    }
}
