import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { lookupActiveGiftCard } from "@/modules/coupons/lib";

// POST /api/pos/gift-card-lookup — check a gift-card code for the POS redeem box.
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.POS_SHIFT_OPEN);
    if (response) return response;
    const { data, error } = await validateRequest(req, z.object({ code: z.string().trim().min(1).max(40) }));
    if (error) return error;
    try {
        const gc = await lookupActiveGiftCard(prisma, data.code, new Date());
        if (!gc) return NextResponse.json({ ok: false, reason: "Gift card not found" });
        if (gc.status !== "ACTIVE") return NextResponse.json({ ok: false, reason: `Gift card is ${gc.status.toLowerCase()}` });
        if (gc.balance <= 0) return NextResponse.json({ ok: false, reason: "Gift card has no balance" });
        return NextResponse.json({ ok: true, id: gc.id, code: gc.code, balance: gc.balance });
    } catch (e) {
        return handleApiError(e, "Gift-card lookup failed");
    }
}
