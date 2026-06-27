import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// Phase 4 G1: UNIVERSAL_VOUCHER is the spine target receipts now allocate against;
// JOURNAL_ENTRY kept for back-compat until G5 retires the legacy GL tables.
const TARGET_TYPES = ["INVOICE", "VOUCHER", "JOURNAL_ENTRY", "UNIVERSAL_VOUCHER"] as const;
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

// GET /api/accountancy/allocations?targetType=INVOICE&targetId=42
// Lists allocations linked to a particular target (or by source if ?sourceType=&sourceId=).
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
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

// POST /api/accountancy/allocations
// Create a free-form bill-wise link between any two vouchers.
export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.FINANCE_ALLOCATION_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;

    try {
        // G5: re-home a VOUCHER target onto the universal-voucher spine
        // (UNIVERSAL_VOUCHER + the bill's universalVoucherId) so settlements read
        // off the spine and the Voucher table can retire. Falls back to VOUCHER
        // when the bill has no spine yet (defensive — posted bills always do).
        let { targetType, targetId } = data;
        if (targetType === "VOUCHER") {
            const bill = await prisma.voucher.findUnique({ where: { id: targetId }, select: { universalVoucherId: true } });
            if (bill?.universalVoucherId != null) {
                targetType = "UNIVERSAL_VOUCHER";
                targetId   = bill.universalVoucherId;
            }
        }
        const allocation = await prisma.voucherAllocation.create({
            data: { ...data, targetType, targetId, createdById: user!.id },
        });
        return NextResponse.json(allocation, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create allocation");
    }
}
