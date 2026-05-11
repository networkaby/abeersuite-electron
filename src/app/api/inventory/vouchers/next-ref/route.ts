import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { invNextRef } from "@/modules/inventory/lib/stock";
import { InvVoucherType } from "@/generated/prisma/client";

// GET /api/inventory/vouchers/next-ref?type=SALE|PURCHASE|ESTIMATE
// Preview the next inventory-voucher reference (e.g. SV-2026-0042) WITHOUT
// incrementing — the actual reference is generated atomically inside the
// transaction at save time via invNextRef(). If two users save concurrently
// the live reference may differ by ±1 from this preview.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const type = (searchParams.get("type") ?? "SALE") as InvVoucherType;

    const reference = await invNextRef(prisma, type);
    return NextResponse.json({ reference });
}
